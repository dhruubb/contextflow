import Link from 'next/link';
import { Suspense } from 'react';
import { CheckSquare, Flag } from 'lucide-react';
import { requireContext } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { computeHealth } from '@/lib/continuity';
import { getMembers, TASK_SELECT, type TaskRow } from '@/lib/queries';
import { Avatar, Card, Empty } from '@/components/ui';
import { CompleteCheck, NextStepButton, OwnerPicker, StatusPill, TaskRowMenu, type ActionTask } from '@/components/task-actions';
import { cn, isOverdue } from '@/lib/utils';
import { NewTaskButton } from './task-client';
import { TaskFilters } from './task-filters';

export const metadata = { title: 'Action Items' };

type SP = { status?: string; filter?: string; assignee?: string; q?: string; sort?: string };
const RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const TZ = 'Asia/Kolkata';
const DAY = 86_400_000;
const toAction = (t: TaskRow): ActionTask => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, due_date: t.due_date, assignee_id: t.assignee_id });

function DueCell({ t }: { t: TaskRow }) {
  if (!t.due_date) return <span className="text-xs text-muted-foreground/60">No date</span>;
  const d = new Date(t.due_date);
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: TZ });
  if (t.status === 'done') return <span className="text-xs text-muted-foreground">{date}</span>;
  const diff = Math.round((d.getTime() - Date.now()) / DAY);
  const late = isOverdue(t.due_date, t.status);
  const rel = late ? `${Math.max(1, -diff)}d late` : diff <= 0 ? 'today' : diff === 1 ? 'tomorrow' : `in ${diff}d`;
  return (
    <div className="leading-tight">
      <p className={cn('text-sm tabular-nums', late && 'font-medium text-red-600 dark:text-red-400')}>{date}</p>
      <p className={cn('text-[11px]', late ? 'text-red-600/80 dark:text-red-400/80' : diff <= 1 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>{rel}</p>
    </div>
  );
}

function PriorityMeta({ p }: { p: string }) {
  if (p === 'urgent' || p === 'high')
    return (
      <span className={cn('inline-flex items-center gap-1 font-medium', p === 'urgent' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400')}>
        <Flag className="size-3" /> {p === 'urgent' ? 'Urgent' : 'High'}
      </span>
    );
  return <span className="capitalize">{p}</span>;
}

export default async function TasksPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const me = ctx.user.id;

  const [{ data }, members, { data: meetings }, health] = await Promise.all([
    ctx.supabase.from('action_items').select(TASK_SELECT).eq('workspace_id', ctx.workspace.id),
    getMembers(ctx),
    ctx.supabase.from('meetings').select('id,title').eq('workspace_id', ctx.workspace.id).order('scheduled_at', { ascending: false }).limit(30),
    computeHealth(ctx.supabase, ctx.workspace.id),
  ]);
  const all = (data ?? []) as unknown as TaskRow[];
  const openAll = all.filter((t) => t.status !== 'done');

  const FILTERS: Record<string, (t: TaskRow) => boolean> = {
    '': (t) => t.status !== 'done',
    mine: (t) => t.assignee_id === me && t.status !== 'done',
    overdue: (t) => isOverdue(t.due_date, t.status),
    blocked: (t) => t.status === 'blocked',
    unassigned: (t) => !t.assignee_id && t.status !== 'done',
  };
  const tabs = [
    { key: '', label: 'Open', count: openAll.length },
    { key: 'mine', label: 'Assigned to me', count: all.filter(FILTERS.mine).length },
    { key: 'overdue', label: 'Overdue', count: all.filter(FILTERS.overdue).length, alert: true },
    { key: 'blocked', label: 'Blocked', count: all.filter(FILTERS.blocked).length, alert: true },
    { key: 'unassigned', label: 'No owner', count: all.filter(FILTERS.unassigned).length, alert: true },
    { key: 'done', label: 'Completed', count: all.length - openAll.length },
  ];

  let rows = sp.status === 'done' ? all.filter((t) => t.status === 'done') : all.filter(FILTERS[sp.filter ?? ''] ?? FILTERS['']);
  if (sp.assignee) rows = rows.filter((t) => t.assignee_id === sp.assignee);
  if (sp.q?.trim()) rows = rows.filter((t) => t.title.toLowerCase().includes(sp.q!.trim().toLowerCase()));
  rows.sort((a, b) =>
    sp.sort === 'priority' ? RANK[a.priority] - RANK[b.priority] : sp.sort === 'updated' ? b.updated_at.localeCompare(a.updated_at) : (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'),
  );

  const isLead = can(ctx.role, 'task.manage_any');
  const isViewer = ctx.role === 'viewer';
  const owners = members.filter((m) => m.role !== 'viewer').map((m) => ({ id: m.user_id, name: m.full_name }));
  const canEdit = (t: TaskRow) => isLead || (!isViewer && (t.assignee_id === me || t.creator_id === me));
  const canReassign = (t: TaskRow) => isLead || (!isViewer && t.assignee_id === me);

  return (
    <div className="animate-in">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Action Items</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Every task, from the meeting it came from to its outcome.</p>
        </div>
        {can(ctx.role, 'task.create') && <NewTaskButton members={owners} meetings={meetings ?? []} />}
      </div>

      <Suspense>
        <TaskFilters tabs={tabs} owners={members.map((m) => ({ id: m.user_id, name: m.full_name }))} />
      </Suspense>

      <Card className="overflow-visible">
        <div className={'hidden items-center gap-4 border-b bg-muted/30 px-4 py-2 text-[11px] font-medium text-muted-foreground lg:grid lg:grid-cols-[28px_minmax(0,1fr)_170px_96px_120px_116px_32px]'}>
          <span />
          <span>Task</span>
          <span>Owner</span>
          <span>Due</span>
          <span>Status</span>
          <span>Next step</span>
          <span />
        </div>

        {rows.length === 0 ? (
          <div className="p-6">
            <Empty title={sp.filter === 'overdue' ? 'Nothing overdue' : sp.q ? 'No tasks match your search' : 'No tasks here'} icon={<CheckSquare />}>
              {sp.filter === 'overdue' ? 'Every open task is on schedule.' : 'Try another tab, or approve tasks from a meeting.'}
            </Empty>
          </div>
        ) : (
          <ul className="divide-y">
            {rows.map((t) => {
              const editable = canEdit(t);
              return (
                <li key={t.id} className={'grid grid-cols-[28px_minmax(0,1fr)_32px] items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-accent/40 lg:grid-cols-[28px_minmax(0,1fr)_170px_96px_120px_116px_32px]'}>
                  <CompleteCheck task={toAction(t)} editable={editable} />

                  <div className="min-w-0">
                    <Link href={`/tasks/${t.id}`} className={cn('block truncate text-sm font-medium hover:underline', t.status === 'done' && 'text-muted-foreground line-through decoration-muted-foreground/50')}>
                      {t.title}
                    </Link>
                    <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                      <PriorityMeta p={t.priority} />
                      {t.meeting && <><span className="text-muted-foreground/40">·</span><Link href={`/meetings/${t.meeting.id}`} className="truncate hover:text-foreground">{t.meeting.title}</Link></>}
                      {t.status === 'done' && t.outcome_notes && <><span className="text-muted-foreground/40">·</span><span className="truncate">{t.outcome_notes}</span></>}
                    </p>
                  </div>

                  <div className="hidden min-w-0 items-center gap-2 lg:flex">
                    <Avatar name={t.assignee?.full_name ?? '?'} className={cn('size-6 text-[9px]', !t.assignee && 'opacity-30')} />
                    <OwnerPicker task={toAction(t)} members={owners} editable={canReassign(t) && t.status !== 'done'} />
                  </div>

                  <div className="hidden lg:block"><DueCell t={t} /></div>

                  <div className="hidden lg:block"><StatusPill task={toAction(t)} editable={editable} /></div>

                  <div className="hidden lg:block"><NextStepButton task={toAction(t)} editable={editable} /></div>

                  <div className="justify-self-end">
                    <TaskRowMenu task={toAction(t)} canEdit={editable} carryTo={isLead ? health.nextMeeting : null} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {isViewer && <p className="mt-3 text-xs text-muted-foreground">You have view-only access. Ask a team lead to change tasks.</p>}
    </div>
  );
}
