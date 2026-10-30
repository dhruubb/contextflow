'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRightLeft, Check, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/client-api';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Select, Textarea } from '@/components/ui';
import { fmtDate, isOverdue } from '@/lib/utils';

/* ---------------------------------------------------------------- status */
export function MeetingStatusControl({ meetingId, status }: { meetingId: string; status: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  async function set(next: string) {
    setLoading(true);
    try {
      await api(`/api/meetings/${meetingId}`, { method: 'PATCH', body: { status: next } });
      toast.success(`Meeting marked ${next.replace('_', ' ')}`);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  if (status === 'scheduled') return <Button size="sm" variant="outline" loading={loading} onClick={() => set('in_progress')}>Start meeting</Button>;
  if (status === 'in_progress') return <Button size="sm" variant="outline" loading={loading} onClick={() => set('completed')}>Mark completed</Button>;
  return null;
}

/* ---------------------------------------------------------------- notes */
export function NotesEditor({ meetingId, initial, canEdit }: { meetingId: string; initial: string; canEdit: boolean }) {
  const router = useRouter();
  const [notes, setNotes] = useState(initial);
  const [saving, setSaving] = useState(false);
  const dirty = notes !== initial;
  async function save() {
    setSaving(true);
    try {
      await api(`/api/meetings/${meetingId}`, { method: 'PATCH', body: { raw_notes: notes } });
      toast.success('Notes saved');
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Raw notes</CardTitle>
          <CardDescription>Type or paste notes. AI extraction works on what is saved here.</CardDescription>
        </div>
        {canEdit && (
          <Button size="sm" onClick={save} loading={saving} disabled={!dirty}>
            {dirty ? 'Save notes' : 'Saved'}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {canEdit ? (
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={9} placeholder="Who said what, what was agreed, who owns what, by when…" className="font-mono text-[13px]" />
        ) : (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{initial || 'No notes yet.'}</p>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------- attendance */
export function AttendanceEditor({
  meetingId,
  participants,
  members,
  canEdit,
  completed,
}: {
  meetingId: string;
  participants: { user_id: string; attended: boolean; name: string }[];
  members: { id: string; name: string }[];
  canEdit: boolean;
  completed: boolean;
}) {
  const router = useRouter();
  const [list, setList] = useState(participants);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState('');
  const dirty = JSON.stringify(list) !== JSON.stringify(participants);
  async function save() {
    setSaving(true);
    try {
      await api(`/api/meetings/${meetingId}`, { method: 'PATCH', body: { participants: list.map(({ user_id, attended }) => ({ user_id, attended })) } });
      toast.success('Attendance saved');
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const notIn = members.filter((m) => !list.some((p) => p.user_id === m.id));
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Participants</CardTitle>
          <CardDescription>{completed ? `${list.filter((p) => p.attended).length} of ${list.length} attended` : 'Tick who attended'}</CardDescription>
        </div>
        {canEdit && dirty && <Button size="sm" onClick={save} loading={saving}>Save</Button>}
      </CardHeader>
      <CardContent className="space-y-1">
        {list.map((p) => (
          <div key={p.user_id} className="flex items-center gap-2 text-sm">
            {canEdit ? (
              <input type="checkbox" checked={p.attended} onChange={() => setList(list.map((x) => (x.user_id === p.user_id ? { ...x, attended: !x.attended } : x)))} className="accent-[hsl(var(--primary))]" />
            ) : (
              <span className={`size-2 rounded-full ${p.attended ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
            )}
            <span className="flex-1">{p.name}</span>
            {completed && !p.attended && <Badge tone="indigo">missed</Badge>}
            {canEdit && (
              <button onClick={() => setList(list.filter((x) => x.user_id !== p.user_id))} className="text-muted-foreground hover:text-red-500" aria-label="Remove">
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        ))}
        {canEdit && notIn.length > 0 && (
          <div className="flex gap-2 pt-2">
            <Select value={adding} onChange={(e) => setAdding(e.target.value)} className="h-8 text-xs">
              <option value="">Add participant…</option>
              {notIn.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
            <Button size="sm" variant="outline" disabled={!adding} onClick={() => { const m = members.find((x) => x.id === adding)!; setList([...list, { user_id: m.id, name: m.name, attended: false }]); setAdding(''); }}>
              Add
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------- carry forward */
export function CarryForwardPanel({ meetingId, candidates }: { meetingId: string; candidates: { id: string; title: string; status: string; due_date: string | null }[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<string[]>(() => candidates.filter((c) => isOverdue(c.due_date, c.status) || c.status === 'blocked').map((c) => c.id));
  const [loading, setLoading] = useState(false);
  async function carry() {
    setLoading(true);
    try {
      const r = await api<{ carried: number }>(`/api/meetings/${meetingId}/carry-forward`, { body: { task_ids: sel } });
      toast.success(`${r.carried} task(s) carried forward with full history`);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-1.5"><ArrowRightLeft className="size-4 text-amber-500" /> Carry forward</CardTitle>
          <CardDescription>Unresolved tasks from earlier work. Overdue and blocked are pre-selected.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {candidates.length === 0 ? (
          <p className="text-xs text-muted-foreground">Every unresolved task is already on this meeting.</p>
        ) : (
          <>
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {candidates.map((t) => (
                <label key={t.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={sel.includes(t.id)} onChange={() => setSel(sel.includes(t.id) ? sel.filter((x) => x !== t.id) : [...sel, t.id])} className="accent-[hsl(var(--primary))]" />
                  <span className="truncate">{t.title}</span>
                  <span className={`ml-auto shrink-0 text-[11px] ${isOverdue(t.due_date, t.status) ? 'text-red-500' : 'text-muted-foreground'}`}>{t.status === 'blocked' ? 'blocked' : fmtDate(t.due_date)}</span>
                </label>
              ))}
            </div>
            <Button size="sm" className="mt-3 w-full" variant="outline" onClick={carry} loading={loading} disabled={sel.length === 0}>
              Carry {sel.length} into this meeting
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------- AI extraction & review */
interface Suggestion {
  include: boolean;
  title: string;
  description: string | null;
  assignee_id: string;
  due_date: string;
  priority: string;
  evidence: string | null;
  owner_name: string | null;
}

export function AiExtractPanel({ meetingId, hasNotes, canApply, members }: { meetingId: string; hasNotes: boolean; canApply: boolean; members: { id: string; name: string }[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ model: string; latencyMs: number } | null>(null);
  const [summary, setSummary] = useState('');
  const [decisions, setDecisions] = useState<{ include: boolean; title: string; description: string | null; rationale: string | null }[]>([]);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [questions, setQuestions] = useState<string[]>([]);
  const ready = meta !== null;

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const r = await api<{
        model: string; latencyMs: number; summary: string; open_questions: string[];
        decisions: { title: string; description: string | null; rationale: string | null }[];
        action_items: { title: string; description: string | null; owner_id: string | null; owner_name: string | null; deadline: string | null; priority: string; evidence: string | null }[];
      }>(`/api/meetings/${meetingId}/extract`, { method: 'POST' });
      setMeta({ model: r.model, latencyMs: r.latencyMs });
      setSummary(r.summary);
      setDecisions(r.decisions.map((d) => ({ ...d, include: true })));
      setItems(r.action_items.map((a) => ({ include: true, title: a.title, description: a.description, assignee_id: a.owner_id ?? '', due_date: a.deadline ?? '', priority: a.priority, evidence: a.evidence, owner_name: a.owner_name })));
      setQuestions(r.open_questions);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function apply() {
    setSaving(true);
    try {
      const r = await api<{ decisions: number; tasks: number; skippedDuplicates: number }>(`/api/meetings/${meetingId}/apply`, {
        body: {
          summary,
          decisions: decisions.filter((d) => d.include).map(({ title, description, rationale }) => ({ title, description, rationale })),
          action_items: items.filter((i) => i.include).map((i) => ({ title: i.title, description: i.description, assignee_id: i.assignee_id || null, due_date: i.due_date || null, priority: i.priority })),
        },
      });
      toast.success(`Saved ${r.decisions} decision(s) and ${r.tasks} task(s)${r.skippedDuplicates ? ` · ${r.skippedDuplicates} duplicate(s) skipped` : ''}. Owners notified.`);
      setMeta(null);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const upd = (i: number, patch: Partial<Suggestion>) => setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <Card className="border-indigo-500/30">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-1.5"><Sparkles className="size-4 text-indigo-500" /> AI recap & extraction</CardTitle>
          <CardDescription>Groq drafts a summary, decisions and tasks. Nothing is saved until you review and approve.</CardDescription>
        </div>
        <Button size="sm" variant="secondary" onClick={run} loading={loading} disabled={!hasNotes}>
          {ready ? 'Re-run' : 'Extract with AI'}
        </Button>
      </CardHeader>
      <CardContent>
        {!hasNotes && !ready && <p className="text-xs text-muted-foreground">Save at least a few lines of notes first.</p>}
        {error && <p className="rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
        {ready && (
          <div className="animate-in space-y-4">
            <p className="text-[11px] text-muted-foreground">{meta.model} · {(meta.latencyMs / 1000).toFixed(1)}s · review everything below</p>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Summary</p>
              <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Decisions ({decisions.filter((d) => d.include).length}/{decisions.length})</p>
              {decisions.length === 0 && <p className="text-xs text-muted-foreground">None found.</p>}
              <div className="space-y-1.5">
                {decisions.map((d, i) => (
                  <label key={i} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                    <input type="checkbox" checked={d.include} onChange={() => setDecisions(decisions.map((x, j) => (j === i ? { ...x, include: !x.include } : x)))} className="mt-1 accent-[hsl(var(--primary))]" />
                    <span className="flex-1">
                      <Input value={d.title} onChange={(e) => setDecisions(decisions.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} className="h-8" />
                      {d.rationale && <span className="mt-1 block text-xs text-muted-foreground">Why: {d.rationale}</span>}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Action items ({items.filter((i) => i.include).length}/{items.length})</p>
              {items.length === 0 && <p className="text-xs text-muted-foreground">None found.</p>}
              <div className="space-y-2">
                {items.map((it, i) => (
                  <div key={i} className={`rounded-md border p-2 ${it.include ? '' : 'opacity-50'}`}>
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={it.include} onChange={() => upd(i, { include: !it.include })} className="accent-[hsl(var(--primary))]" />
                      <Input value={it.title} onChange={(e) => upd(i, { title: e.target.value })} className="h-8 flex-1" />
                    </div>
                    <div className="mt-2 grid gap-2 pl-6 sm:grid-cols-3">
                      <Select value={it.assignee_id} onChange={(e) => upd(i, { assignee_id: e.target.value })} className="h-8 text-xs">
                        <option value="">Unassigned{it.owner_name ? ` (notes say “${it.owner_name}”)` : ''}</option>
                        {members.map((m) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </Select>
                      <Input type="date" value={it.due_date} onChange={(e) => upd(i, { due_date: e.target.value })} className="h-8 text-xs" />
                      <Select value={it.priority} onChange={(e) => upd(i, { priority: e.target.value })} className="h-8 text-xs">
                        {['low', 'medium', 'high', 'urgent'].map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </Select>
                    </div>
                    {it.evidence && <p className="mt-1.5 pl-6 text-[11px] italic text-muted-foreground">“{it.evidence}”</p>}
                  </div>
                ))}
              </div>
            </div>
            {questions.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Open questions</p>
                <ul className="list-disc pl-5 text-xs text-muted-foreground">{questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
              </div>
            )}
            <div className="flex items-center justify-end gap-2 border-t pt-3">
              {!canApply && <span className="mr-auto text-xs text-muted-foreground">Only a team lead or admin can approve and save.</span>}
              <Button variant="ghost" onClick={() => setMeta(null)}>Discard</Button>
              <Button onClick={apply} loading={saving} disabled={!canApply}>
                <Check /> Approve & save
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
