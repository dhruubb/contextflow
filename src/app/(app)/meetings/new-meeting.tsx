'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/client-api';
import { Button, Dialog, Field, Input, Textarea } from '@/components/ui';
import { fmtDate, isOverdue, toDateTimeInput } from '@/lib/utils';

export function NewMeetingButton({
  members,
  openTasks,
  selfId,
}: {
  members: { id: string; name: string }[];
  openTasks: { id: string; title: string; status: string; due_date: string | null }[];
  selfId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [agenda, setAgenda] = useState('');
  const [when, setWhen] = useState(() => {
    const d = new Date(Date.now() + 86_400_000);
    d.setHours(10, 0, 0, 0);
    return toDateTimeInput(d);
  });
  const [participants, setParticipants] = useState<string[]>([selfId]);
  const [carry, setCarry] = useState<string[]>([]);

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  async function submit() {
    setLoading(true);
    try {
      const { meeting } = await api<{ meeting: { id: string } }>('/api/meetings', {
        body: { title, agenda: agenda || null, scheduled_at: new Date(when).toISOString(), participant_ids: participants, carry_forward_task_ids: carry },
      });
      toast.success('Meeting created — participants notified');
      setOpen(false);
      router.push(`/meetings/${meeting.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus /> New meeting
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New meeting"
        description="Participants get a Telegram/in-app notification."
        wide
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} loading={loading} disabled={title.trim().length < 3}>Create meeting</Button>
          </>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <Field label="Title">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sprint planning" autoFocus />
            </Field>
            <Field label="Date & time">
              <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </Field>
            <Field label="Agenda">
              <Textarea value={agenda} onChange={(e) => setAgenda(e.target.value)} rows={4} placeholder="1. …" />
            </Field>
          </div>
          <div className="space-y-3">
            <Field label="Participants">
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                {members.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={participants.includes(m.id)} onChange={() => setParticipants(toggle(participants, m.id))} className="accent-[hsl(var(--primary))]" />
                    {m.name}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Carry forward unresolved tasks" hint="Tasks keep their id and full history.">
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border p-2">
                {openTasks.length === 0 && <p className="text-xs text-muted-foreground">No unresolved tasks.</p>}
                {openTasks.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={carry.includes(t.id)} onChange={() => setCarry(toggle(carry, t.id))} className="accent-[hsl(var(--primary))]" />
                    <span className="truncate">{t.title}</span>
                    <span className={`ml-auto shrink-0 text-[11px] ${isOverdue(t.due_date, t.status) ? 'text-red-500' : 'text-muted-foreground'}`}>{fmtDate(t.due_date)}</span>
                  </label>
                ))}
              </div>
            </Field>
          </div>
        </div>
      </Dialog>
    </>
  );
}
