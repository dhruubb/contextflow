'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Repeat2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/client-api';
import type { HandoverContext } from '@/lib/ai/prompts';
import { Button, Dialog, Field, Select, Textarea } from '@/components/ui';
import { PriorityBadge } from '@/components/badges';
import { HandoverBrief } from '@/components/handover-brief';
import { fmtDate, isOverdue } from '@/lib/utils';

interface T { id: string; title: string; status: string; priority: string; due_date: string | null; assignee_id: string | null }

export function HandoverWizard({ members, tasks, selfId, canAny, initial }: { members: { id: string; name: string }[]; tasks: T[]; selfId: string; canAny: boolean; initial?: { from?: string; taskId?: string } }) {
  const router = useRouter();
  const [open, setOpen] = useState(Boolean(initial?.taskId));
  const [from, setFrom] = useState(canAny ? initial?.from ?? '' : selfId);
  const [to, setTo] = useState('');
  const [sel, setSel] = useState<string[]>(() => (initial?.taskId && tasks.some((t) => t.id === initial.taskId && t.assignee_id === (canAny ? initial.from : selfId)) ? [initial.taskId] : []));
  const [notes, setNotes] = useState('');
  const [brief, setBrief] = useState<HandoverContext | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'ai' | 'confirm' | null>(null);

  const theirs = useMemo(() => tasks.filter((t) => t.assignee_id === from), [tasks, from]);
  const titles = Object.fromEntries(tasks.map((t) => [t.id, t.title]));

  function reset() {
    setBrief(null);
    setAiError(null);
  }

  async function generate() {
    setBusy('ai');
    setAiError(null);
    try {
      const r = await api<{ handover: HandoverContext }>('/api/handovers/preview', { body: { outgoing_user_id: from, incoming_user_id: to, task_ids: sel } });
      setBrief(r.handover);
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function confirm() {
    setBusy('confirm');
    try {
      const r = await api<{ handoverId: string; transferred: number }>('/api/handovers', {
        body: { outgoing_user_id: from, incoming_user_id: to, task_ids: sel, ai_summary: brief ? JSON.stringify(brief) : null, notes: notes || null },
      });
      toast.success(`${r.transferred} task(s) handed over — new owner notified`);
      setOpen(false);
      router.push(`/handovers/${r.handoverId}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}><Repeat2 /> New handover</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Hand over unfinished work"
        description="1. Pick people and tasks · 2. Generate the AI brief · 3. Confirm transfer"
        wide
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="secondary" onClick={generate} loading={busy === 'ai'} disabled={!from || !to || from === to || sel.length === 0}>
              <Sparkles /> {brief ? 'Regenerate brief' : 'Generate AI brief'}
            </Button>
            <Button onClick={confirm} loading={busy === 'confirm'} disabled={!from || !to || from === to || sel.length === 0}>
              Confirm transfer
            </Button>
          </>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Outgoing owner">
                <Select value={from} disabled={!canAny} onChange={(e) => { setFrom(e.target.value); setSel([]); reset(); }}>
                  <option value="">Select…</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </Select>
              </Field>
              <Field label="Incoming owner">
                <Select value={to} onChange={(e) => { setTo(e.target.value); reset(); }}>
                  <option value="">Select…</option>
                  {members.filter((m) => m.id !== from).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </Select>
              </Field>
            </div>
            <Field label={`Unfinished tasks${from ? ` (${theirs.length})` : ''}`}>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
                {!from && <p className="text-xs text-muted-foreground">Choose the outgoing owner first.</p>}
                {from && theirs.length === 0 && <p className="text-xs text-muted-foreground">No unfinished tasks.</p>}
                {theirs.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={sel.includes(t.id)} onChange={() => { setSel(sel.includes(t.id) ? sel.filter((x) => x !== t.id) : [...sel, t.id]); reset(); }} className="accent-[hsl(var(--primary))]" />
                    <span className="truncate">{t.title}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-1">
                      <PriorityBadge priority={t.priority} />
                      <span className={`text-[11px] ${isOverdue(t.due_date, t.status) ? 'text-red-500' : 'text-muted-foreground'}`}>{fmtDate(t.due_date)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Notes (optional)">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Reason for handover, availability…" />
            </Field>
          </div>
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="mb-2 flex items-center gap-1 text-xs font-medium"><Sparkles className="size-3.5 text-indigo-500" /> AI handover brief</p>
            {aiError && <p className="mb-2 rounded border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-600 dark:text-red-400">{aiError} You can still confirm the transfer without a brief.</p>}
            {brief ? <HandoverBrief brief={brief} titles={titles} /> : <p className="text-xs text-muted-foreground">Generate a brief to give the incoming owner the history, decisions, documents and next steps for each task. Optional, but recommended.</p>}
          </div>
        </div>
      </Dialog>
    </>
  );
}
