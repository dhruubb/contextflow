'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, MessageSquare, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/client-api';
import { Button, Card, CardContent, CardHeader, CardTitle, Dialog, Field, Input, Select, Textarea } from '@/components/ui';
import { toDateInput } from '@/lib/utils';

export function NewTaskButton({ members, meetings }: { members: { id: string; name: string }[]; meetings: { id: string; title: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [f, setF] = useState({ title: '', description: '', assignee_id: '', due_date: '', priority: 'medium', source_meeting_id: '' });
  async function submit() {
    setLoading(true);
    try {
      const { task } = await api<{ task: { id: string } }>('/api/tasks', {
        body: { ...f, description: f.description || null, assignee_id: f.assignee_id || null, due_date: f.due_date || null, source_meeting_id: f.source_meeting_id || null },
      });
      toast.success(f.assignee_id ? 'Task created — owner notified' : 'Task created');
      setOpen(false);
      router.push(`/tasks/${task.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus /> New task</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New task"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} loading={loading} disabled={f.title.trim().length < 2}>Create task</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus /></Field>
          <Field label="Description"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={3} /></Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Owner">
              <Select value={f.assignee_id} onChange={(e) => setF({ ...f, assignee_id: e.target.value })}>
                <option value="">Unassigned</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </Field>
            <Field label="Deadline"><Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
            <Field label="Priority">
              <Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
                {['low', 'medium', 'high', 'urgent'].map((p) => <option key={p} value={p}>{p}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Source meeting (optional)">
            <Select value={f.source_meeting_id} onChange={(e) => setF({ ...f, source_meeting_id: e.target.value })}>
              <option value="">None</option>
              {meetings.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
            </Select>
          </Field>
        </div>
      </Dialog>
    </>
  );
}

interface TaskLite {
  id: string;
  status: string;
  priority: string;
  due_date: string | null;
  assignee_id: string | null;
}

export function TaskActions({ task, members, canManage, canReassign }: { task: TaskLite; members: { id: string; name: string }[]; canManage: boolean; canReassign: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [note, setNote] = useState('');
  const [reassignTo, setReassignTo] = useState(task.assignee_id ?? '');

  async function patch(body: Record<string, unknown>, key: string, msg: string) {
    setBusy(key);
    try {
      await api(`/api/tasks/${task.id}`, { method: 'PATCH', body });
      toast.success(msg);
      router.refresh();
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (!canManage) {
    return (
      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">You can view this task. Only its owner or a team lead can change it.</CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle>Update</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <Field label="Status">
          <div className="grid grid-cols-3 gap-1">
            {(['todo', 'in_progress', 'blocked'] as const).map((s) => (
              <Button key={s} size="sm" variant={task.status === s ? 'default' : 'outline'} loading={busy === s} onClick={() => patch({ status: s, note: note || null }, s, `Moved to ${s.replace('_', ' ')}`)}>
                {s === 'todo' ? 'To Do' : s === 'in_progress' ? 'In Progress' : 'Blocked'}
              </Button>
            ))}
          </div>
        </Field>
        {task.status !== 'done' ? (
          <Button className="w-full" onClick={() => setCloseOpen(true)}><CheckCircle2 /> Close with outcome</Button>
        ) : (
          <Button className="w-full" variant="outline" loading={busy === 'reopen'} onClick={() => patch({ status: 'todo', note: 'Reopened' }, 'reopen', 'Task reopened')}>Reopen task</Button>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Priority">
            <Select defaultValue={task.priority} onChange={(e) => patch({ priority: e.target.value }, 'priority', 'Priority updated')} className="h-8 text-xs">
              {['low', 'medium', 'high', 'urgent'].map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </Field>
          <Field label="Deadline">
            <Input type="date" defaultValue={toDateInput(task.due_date)} onBlur={(e) => e.target.value !== toDateInput(task.due_date) && patch({ due_date: e.target.value || null }, 'due', 'Deadline updated')} className="h-8 text-xs" />
          </Field>
        </div>
        {canReassign && (
          <Field label="Reassign">
            <div className="flex gap-2">
              <Select value={reassignTo} onChange={(e) => setReassignTo(e.target.value)} className="h-8 text-xs">
                <option value="">Unassigned</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
              <Button size="sm" variant="outline" disabled={reassignTo === (task.assignee_id ?? '')} loading={busy === 'reassign'} onClick={() => patch({ assignee_id: reassignTo || null, note: note || null }, 'reassign', 'Reassigned — new owner notified')}>
                Save
              </Button>
            </div>
          </Field>
        )}
        <Field label="Note / comment">
          <div className="flex gap-2">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why? (added to history)" className="h-8 text-xs" />
            <Button size="sm" variant="outline" disabled={!note.trim()} loading={busy === 'note'} onClick={async () => { if (await patch({ note }, 'note', 'Comment added')) setNote(''); }}>
              <MessageSquare />
            </Button>
          </div>
        </Field>
      </CardContent>
      <Dialog
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        title="Close task"
        description="Record the outcome so the context survives after the task is done."
        footer={
          <>
            <Button variant="outline" onClick={() => setCloseOpen(false)}>Cancel</Button>
            <Button loading={busy === 'done'} disabled={outcome.trim().length < 5} onClick={async () => { if (await patch({ status: 'done', outcome_notes: outcome }, 'done', 'Task closed with outcome')) setCloseOpen(false); }}>
              Close task
            </Button>
          </>
        }
      >
        <Field label="Outcome (required)">
          <Textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} rows={4} placeholder="What was done, result, links, follow-ups…" autoFocus />
        </Field>
      </Dialog>
    </Card>
  );
}
