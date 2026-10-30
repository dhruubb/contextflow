'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRightLeft, Ban, CalendarClock, Check, CheckCircle2, ChevronDown, ExternalLink, MoreHorizontal, Play, Repeat2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/client-api';
import { Button, Dialog, Field, Input, Textarea } from '@/components/ui';
import { cn, toDateInput } from '@/lib/utils';

export interface ActionTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  assignee_id: string | null;
}
export type MemberOpt = { id: string; name: string };

/* --------------------------------------------------------------- shared patch hook */
export function useTaskPatch() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  async function patch(taskId: string, body: Record<string, unknown>, msg: string, key = 'x') {
    setBusy(key);
    try {
      await api(`/api/tasks/${taskId}`, { method: 'PATCH', body });
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
  return { patch, busy };
}

/* --------------------------------------------------------------- popover menu */
export function Menu({ trigger, children, align = 'right' }: { trigger: React.ReactNode; children: (close: () => void) => React.ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative inline-block">
      <span onClick={() => setOpen((v) => !v)}>{trigger}</span>
      {open && (
        <div className={cn('animate-in absolute z-30 mt-1 min-w-[200px] rounded-md border bg-card p-1 shadow-lg', align === 'right' ? 'right-0' : 'left-0')}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
export function MenuItem({ icon, children, onClick, href, danger }: { icon?: React.ReactNode; children: React.ReactNode; onClick?: () => void; href?: string; danger?: boolean }) {
  const cls = cn('flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent [&_svg]:size-3.5 [&_svg]:text-muted-foreground', danger && 'text-red-600 dark:text-red-400');
  if (href) return <Link href={href} className={cls}>{icon}{children}</Link>;
  return <button className={cls} onClick={onClick}>{icon}{children}</button>;
}

/* --------------------------------------------------------------- status pill (inline editable) */
const STATUS = [
  { v: 'todo', label: 'To Do', cls: 'border-border bg-muted text-muted-foreground' },
  { v: 'in_progress', label: 'In Progress', cls: 'border-indigo-500/25 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300' },
  { v: 'blocked', label: 'Blocked', cls: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  { v: 'done', label: 'Done', cls: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
];

export function StatusPill({ task, editable }: { task: ActionTask; editable: boolean }) {
  const { patch, busy } = useTaskPatch();
  const [closing, setClosing] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const s = STATUS.find((x) => x.v === task.status) ?? STATUS[0];
  const pill = (
    <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none', s.cls, editable && 'cursor-pointer hover:brightness-110', busy && 'opacity-60')}>
      {s.label}
      {editable && <ChevronDown className="size-3" />}
    </span>
  );
  if (!editable) return pill;
  return (
    <>
      <Menu trigger={pill} align="left">
        {(close) =>
          STATUS.map((o) => (
            <MenuItem
              key={o.v}
              icon={o.v === task.status ? <Check /> : <span className="size-3.5" />}
              onClick={() => {
                close();
                if (o.v === task.status) return;
                if (o.v === 'done') setClosing(true);
                else if (o.v === 'blocked') setBlocking(true);
                else patch(task.id, { status: o.v, note: task.status === 'blocked' ? 'Blocker cleared' : null }, `Moved to ${o.label}`);
              }}
            >
              {o.label}
            </MenuItem>
          ))
        }
      </Menu>
      <CompleteDialog task={task} open={closing} onClose={() => setClosing(false)} />
      <BlockDialog task={task} open={blocking} onClose={() => setBlocking(false)} />
    </>
  );
}

/* --------------------------------------------------------------- complete with outcome */
export function CompleteDialog({ task, open, onClose }: { task: ActionTask; open: boolean; onClose: () => void }) {
  const { patch, busy } = useTaskPatch();
  const [outcome, setOutcome] = useState('');
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Complete “${task.title}”`}
      description="Record the outcome so the context survives after the task is closed."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={!!busy} disabled={outcome.trim().length < 5} onClick={async () => { if (await patch(task.id, { status: 'done', outcome_notes: outcome }, 'Task completed')) { setOutcome(''); onClose(); } }}>
            <CheckCircle2 /> Complete task
          </Button>
        </>
      }
    >
      <Field label="Outcome (required)">
        <Textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} rows={4} autoFocus placeholder="What was done, the result, any follow-ups…" />
      </Field>
    </Dialog>
  );
}

export function CompleteButton({ task, size = 'sm', variant = 'outline' }: { task: ActionTask; size?: 'sm' | 'default'; variant?: 'outline' | 'default' | 'ghost' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}><CheckCircle2 /> Complete</Button>
      <CompleteDialog task={task} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/* --------------------------------------------------------------- owner picker */
export function OwnerPicker({ task, members, editable, compact, primary }: { task: ActionTask; members: MemberOpt[]; editable: boolean; compact?: boolean; primary?: boolean }) {
  const { patch, busy } = useTaskPatch();
  const current = members.find((m) => m.id === task.assignee_id);
  const label = current?.name ?? 'Unassigned';
  if (!editable) return <span className={cn('text-xs', !current && 'text-amber-600 dark:text-amber-400')}>{label}</span>;
  return (
    <Menu
      align="left"
      trigger={
        compact ? (
          <Button size="sm" variant={primary ?? !current ? 'default' : 'outline'} loading={!!busy}><UserPlus /> {current ? 'Reassign' : 'Assign owner'}</Button>
        ) : (
          <button className={cn('inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-accent', !current && 'text-amber-600 dark:text-amber-400', busy && 'opacity-60')}>
            {label} <ChevronDown className="size-3 text-muted-foreground" />
          </button>
        )
      }
    >
      {(close) => (
        <>
          <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground">Assign to</p>
          {members.map((m) => (
            <MenuItem key={m.id} icon={m.id === task.assignee_id ? <Check /> : <span className="size-3.5" />} onClick={() => { close(); if (m.id !== task.assignee_id) patch(task.id, { assignee_id: m.id }, `Assigned to ${m.name} — they've been notified`); }}>
              {m.name}
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  );
}

/* --------------------------------------------------------------- deadline */
export function DeadlineDialog({ task, open, onClose }: { task: ActionTask; open: boolean; onClose: () => void }) {
  const { patch, busy } = useTaskPatch();
  const [date, setDate] = useState(toDateInput(task.due_date) || toDateInput(new Date(Date.now() + 3 * 86_400_000).toISOString()));
  const [note, setNote] = useState('');
  const quick = (days: number) => setDate(toDateInput(new Date(Date.now() + days * 86_400_000).toISOString()));
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Change deadline"
      description={task.title}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={!!busy} disabled={!date} onClick={async () => { if (await patch(task.id, { due_date: date, note: note || null }, 'Deadline updated')) onClose(); }}>Save deadline</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex gap-1.5">
          {[['Tomorrow', 1], ['+3 days', 3], ['+1 week', 7]].map(([l, d]) => (
            <Button key={l} size="sm" variant="outline" onClick={() => quick(d as number)}>{l}</Button>
          ))}
        </div>
        <Field label="New deadline"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Reason (added to task history)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. waiting on vendor export" /></Field>
      </div>
    </Dialog>
  );
}

/* --------------------------------------------------------------- row "…" menu */
export function TaskRowMenu({
  task,
  canEdit,
  carryTo,
}: {
  task: ActionTask;
  canEdit: boolean;
  carryTo?: { id: string; title: string } | null;
}) {
  const router = useRouter();
  const { patch } = useTaskPatch();
  const [dialog, setDialog] = useState<'complete' | 'deadline' | 'block' | null>(null);
  async function carry() {
    try {
      const r = await api<{ carried: number }>(`/api/meetings/${carryTo!.id}/carry-forward`, { body: { task_ids: [task.id] } });
      toast.success(r.carried ? `Added to “${carryTo!.title}”` : 'Already on that meeting');
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return (
    <>
      <Menu trigger={<button className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Task actions"><MoreHorizontal className="size-4" /></button>}>
        {(close) => (
          <>
            <MenuItem href={`/tasks/${task.id}`} icon={<ExternalLink />}>Open task & history</MenuItem>
            {canEdit && task.status !== 'done' && (
              <>
                {task.status !== 'in_progress' && (
                  <MenuItem icon={<Play />} onClick={() => { close(); patch(task.id, { status: 'in_progress', note: task.status === 'blocked' ? 'Blocker cleared' : null }, task.status === 'blocked' ? 'Blocker cleared — back In Progress' : 'Moved to In Progress'); }}>
                    {task.status === 'blocked' ? 'Resume work (blocker cleared)' : 'Start working'}
                  </MenuItem>
                )}
                {task.status !== 'blocked' && <MenuItem icon={<Ban />} onClick={() => { close(); setDialog('block'); }}>Mark as blocked…</MenuItem>}
                <MenuItem icon={<CheckCircle2 />} onClick={() => { close(); setDialog('complete'); }}>Complete with outcome…</MenuItem>
                <MenuItem icon={<CalendarClock />} onClick={() => { close(); setDialog('deadline'); }}>Change deadline…</MenuItem>
                {task.assignee_id && <MenuItem icon={<Repeat2 />} href={`/handovers?task=${task.id}&from=${task.assignee_id}`}>Hand over…</MenuItem>}
              </>
            )}
            {carryTo && task.status !== 'done' && <MenuItem icon={<ArrowRightLeft />} onClick={() => { close(); carry(); }}>Add to next meeting</MenuItem>}
          </>
        )}
      </Menu>
      <CompleteDialog task={task} open={dialog === 'complete'} onClose={() => setDialog(null)} />
      {dialog === 'deadline' && <DeadlineDialog task={task} open onClose={() => setDialog(null)} />}
      <BlockDialog task={task} open={dialog === 'block'} onClose={() => setDialog(null)} />
    </>
  );
}

/* --------------------------------------------------------------- generic small action buttons */
export function StartButton({ task, label, size = 'sm', variant = 'outline', resume }: { task: ActionTask; label?: string; size?: 'sm' | 'default'; variant?: 'outline' | 'default'; resume?: boolean }) {
  const { patch, busy } = useTaskPatch();
  return (
    <Button
      size={size}
      variant={variant}
      loading={!!busy}
      title={resume ? 'The blocker is sorted — move this back to In Progress' : 'Move to In Progress'}
      onClick={() => patch(task.id, { status: 'in_progress', note: resume ? 'Blocker cleared' : null }, resume ? 'Blocker cleared — back In Progress' : 'Started')}
    >
      <Play /> {label ?? (resume ? 'Resume work' : 'Start')}
    </Button>
  );
}

/** Marking a task blocked always asks what it is waiting on — that reason is what the team needs. */
export function BlockDialog({ task, open, onClose }: { task: ActionTask; open: boolean; onClose: () => void }) {
  const { patch, busy } = useTaskPatch();
  const [reason, setReason] = useState('');
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="What is blocking this?"
      description="Blocked means you can't continue until something or someone else moves. The task creator is notified."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={!!busy} disabled={reason.trim().length < 3} onClick={async () => { if (await patch(task.id, { status: 'blocked', note: reason.trim() }, 'Marked as blocked')) { setReason(''); onClose(); } }}>
            Mark as blocked
          </Button>
        </>
      }
    >
      <Field label="Waiting on…">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder="e.g. uptime export from the monitoring vendor" />
      </Field>
    </Dialog>
  );
}

export function DeadlineButton({ task, label = 'Change deadline', variant = 'outline' }: { task: ActionTask; label?: string; variant?: 'outline' | 'default' | 'ghost' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}><CalendarClock /> {label}</Button>
      {open && <DeadlineDialog task={task} open onClose={() => setOpen(false)} />}
    </>
  );
}

export function CarryButton({ meetingId, taskIds, label = 'Add to next meeting', variant = 'outline' }: { meetingId: string; taskIds: string[]; label?: string; variant?: 'outline' | 'default' }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  return (
    <Button
      size="sm"
      variant={variant}
      loading={loading}
      onClick={async () => {
        setLoading(true);
        try {
          const r = await api<{ carried: number }>(`/api/meetings/${meetingId}/carry-forward`, { body: { task_ids: taskIds } });
          toast.success(`${r.carried} task(s) added to the next meeting`);
          router.refresh();
        } catch (e) {
          toast.error((e as Error).message);
        } finally {
          setLoading(false);
        }
      }}
    >
      <ArrowRightLeft /> {label}
    </Button>
  );
}
