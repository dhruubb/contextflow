import Link from 'next/link';
import { CheckSquare, Search } from 'lucide-react';
import { requireContext } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { computeHealth } from '@/lib/continuity';
import { getMembers, TASK_SELECT, type TaskRow } from '@/lib/queries';
import { PageHeader } from '@/components/shell';
import { Avatar, Badge, Button, Card, Empty, Input, Select } from '@/components/ui';
import { PriorityBadge } from '@/components/badges';
import { OwnerPicker, StatusPill, TaskRowMenu, type ActionTask } from '@/components/task-actions';
import { cn, fmtDate, isOverdue } from '@/lib/utils';
import { NewTaskButton } from './task-client';

export const metadata = { title: 'Action Items' };

type SP = { status?: string; filter?: string; assignee?: string; q?: string; sort?: string };
const RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const toAction = (t: TaskRow): ActionTask => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, due_date: t.due_date, assignee_id: t.assignee_id });

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
    '': () => true,
    mine: (t) => t.assignee_id === me && t.status !== 'done',
    overdue: (t) => isOverdue(t.due_date, t.status),
    blocked: (t) => t.status === 'blocked',
    unassigned: (t) => !t.assignee_id && t.status !== 'done',
  };
  const chips = [
    { key: '', label: 'All open', count: openAll.length },
    { key: 'mine', label: 'Mine', count: all.filter(FILTERS.mine).length },
    { key: 'overdue', label: 'Overdue', count: all.filter(FILTERS.overdue).length, tone: 'red' as const },
    { key: 'blocked', label: 'Blocked', count: all.filter(FILTERS.blocked).length, tone: 'amber' as const },
    { key: 'unassigned', label: 'No owner', count: all.filter(FILTERS.unassigned).length, tone: 'amber' as const },
  ];

  let rows = all.filter(FILTERS[sp.filter ?? ''] ?? (() => true));
  if (sp.status) rows = rows.filter((t) => t.status === sp.status);
  if (sp.assignee) rows = rows.filter((t) => t.assignee_id === sp.assignee);
  if (sp.q?.trim()) rows = rows.filter((t) => t.title.toLowerCase().includes(sp.q!.trim().toLowerCase()));
  rows.sort((a, b) =>
    sp.sort === 'priority'
      ? RANK[a.priority] - RANK[b.priority]
      : sp.sort === 'updated'
        ? b.updated_at.localeCompare(a.updated_at)
        : (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'),
  );
  const openRows = rows.filter((t) => t.status !== 'done');
  const doneRows = sp.status === 'done' || sp.filter ? [] : rows.filter((t) => t.status === 'done');
  const showOpen = sp.status === 'done' ? rows : openRows;

  const isLead = can(ctx.role, 'task.manage_any');
  const isViewer = ctx.role === 'viewer';
  const owners = members.filter((m) => m.role !== 'viewer').map((m) => ({ id: m.user_id, name: m.full_name }));
  const canEdit = (t: TaskRow) => isLead || (!isViewer && (t.assignee_id === me || t.creator_id === me));
  const canReassign = (t: TaskRow) => isLead || (!isViewer && t.assignee_id === me);
  const filtered = Boolean(sp.status || sp.assignee || sp.q);

  const Row = ({ t }: { t: TaskRow }) => (
    <li className="group grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2.5 md:grid-cols-[110px_1fr_150px_80px_110px_32px]">
      <div><StatusPill task={toAction(t)} editable={canEdit(t)} /></div>
      <div className="min-w-0">
        <Link href={`/tasks/${t.id}`} className={cn('block truncate text-sm font-medium hover:underline', t.status === 'done' && 'text-muted-foreground line-through decoration-muted-foreground/40')}>{t.title}</Link>
        <p className="truncate text-[11px] text-muted-foreground">
          {t.meeting ? <>from <Link href={`/meetings/${t.meeting.id}`} className="hover:underline">{t.meeting.title}</Link></> : 'Standalone task'}
          {t.ai_generated && <span className="ml-1.5 text-indigo-600 dark:text-indigo-400">· AI-extracted</span>}
          {t.status === 'done' && t.outcome_notes && <> · {t.outcome_notes}</>}
        </p>
      </div>
      <div className="hidden items-center gap-1.5 md:flex">
        <Avatar name={t.assignee?.full_name ?? '?'} className={cn('size-5 text-[9px]', !t.assignee && 'opacity-40')} />
        <OwnerPicker task={toAction(t)} members={owners} editable={canReassign(t) && t.status !== 'done'} />
      </div>
      <div className="hidden md:block"><PriorityBadge priority={t.priority} /></div>
      <div className={cn('hidden text-xs tabular-nums md:block', isOverdue(t.due_date, t.status) ? 'font-medium text-red-600 dark:text-red-400' : 'text-muted-foreground')}>
        {fmtDate(t.due_date)}
        {isOverdue(t.due_date, t.status) && <span className="block text-[10px] font-normal">overdue</span>}
      </div>
      <div className="justify-self-end"><TaskRowMenu task={toAction(t)} canEdit={canEdit(t)} carryTo={isLead ? health.nextMeeting : null} /></div>
    </li>
  );

  return (
    <div className="animate-in">
      <PageHeader
        title="Action Items"
        description="Change status or owner inline · ••• for deadline, hand over, add to next meeting."
        actions={can(ctx.role, 'task.create') && <NewTaskButton members={owners} meetings={meetings ?? []} />}
      />

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {chips.map((c) => {
          const active = (sp.filter ?? '') === c.key && !sp.status;
          return (
            <Link key={c.key} href={c.key ? `/tasks?filter=${c.key}` : '/tasks'}
              className={cn('inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors', active ? 'border-primary/40 bg-primary/10 text-primary' : 'hover:bg-accent')}>
              {c.label}
              <span className={cn('rounded px-1 tabular-nums', c.count && c.tone === 'red' ? 'bg-red-500/15 text-red-600 dark:text-red-400' : c.count && c.tone === 'amber' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-muted text-muted-foreground')}>{c.count}</span>
            </Link>
          );
        })}
        <Link href="/tasks?status=done" className={cn('inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium', sp.status === 'done' ? 'border-primary/40 bg-primary/10 text-primary' : 'hover:bg-accent')}>
          Completed <span className="rounded bg-muted px-1 tabular-nums text-muted-foreground">{all.length - openAll.length}</span>
        </Link>
      </div>

      <form className="mb-3 flex flex-wrap gap-2">
        {sp.filter && <input type="hidden" name="filter" value={sp.filter} />}
        {sp.status && <input type="hidden" name="status" value={sp.status} />}
        <div className="relative">
          <Search className="absolute left-2.5 top-2 size-4 text-muted-foreground" />
          <Input name="q" defaultValue={sp.q} placeholder="Search tasks…" className="h-8 w-56 pl-8 text-xs" />
        </div>
        <Select name="assignee" defaultValue={sp.assignee ?? ''} className="h-8 w-40 text-xs">
          <option value="">Any owner</option>
          {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}
        </Select>
        <Select name="sort" defaultValue={sp.sort ?? 'due'} className="h-8 w-40 text-xs">
          <option value="due">Sort by deadline</option>
          <option value="priority">Sort by priority</option>
          <option value="updated">Recently updated</option>
        </Select>
        <Button size="sm" variant="outline" type="submit">Apply</Button>
        {filtered && <Link href={sp.filter ? `/tasks?filter=${sp.filter}` : '/tasks'} className="self-center text-xs text-muted-foreground hover:text-foreground">Clear</Link>}
      </form>

      <Card className="overflow-visible">
        <div className="hidden grid-cols-[110px_1fr_150px_80px_110px_32px] gap-3 border-b px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:grid">
          <span>Status</span><span>Task</span><span>Owner</span><span>Priority</span><span>Deadline</span><span />
        </div>
        {showOpen.length === 0 && doneRows.length === 0 ? (
          <div className="p-4">
            <Empty title={sp.filter === 'overdue' ? 'Nothing overdue 🎉' : 'No tasks match'} icon={<CheckSquare />}>Try another filter, or approve tasks from a meeting’s AI extraction.</Empty>
          </div>
        ) : (
          <ul className="divide-y">{showOpen.map((t) => <Row key={t.id} t={t} />)}</ul>
        )}
        {doneRows.length > 0 && (
          <details className="border-t">
            <summary className="cursor-pointer list-none px-4 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground">
              Completed · {doneRows.length} <Badge className="ml-1">show</Badge>
            </summary>
            <ul className="divide-y border-t">{doneRows.map((t) => <Row key={t.id} t={t} />)}</ul>
          </details>
        )}
      </Card>
    </div>
  );
}
