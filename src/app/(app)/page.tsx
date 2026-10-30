import Link from 'next/link';
import { AlertTriangle, ArrowRight, CalendarDays, CheckCircle2, CircleDot, Clock, HeartPulse, Repeat2, Sparkles, UserX } from 'lucide-react';
import { requireContext } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { computeHealth, SIGNAL_LABEL } from '@/lib/continuity';
import { getMembers, TASK_SELECT, activityHref, activityText, type TaskRow } from '@/lib/queries';
import { PageHeader } from '@/components/shell';
import { Avatar, Card, CardContent, CardHeader, CardTitle, buttonVariants } from '@/components/ui';
import { PriorityBadge } from '@/components/badges';
import { ScoreRing } from '@/components/score-ring';
import { CarryButton, CompleteButton, DeadlineButton, OwnerPicker, StartButton, StatusPill, TaskRowMenu, type ActionTask } from '@/components/task-actions';
import { NewTaskButton } from './tasks/task-client';
import { NewMeetingButton } from './meetings/new-meeting';
import { cn, fmtDate, fmtDateTime, isOverdue, relTime } from '@/lib/utils';

export const metadata = { title: 'Dashboard' };

type Tone = 'red' | 'amber' | 'indigo' | 'teal';
interface AttentionItem {
  key: string;
  tone: Tone;
  icon: React.ReactNode;
  title: React.ReactNode;
  reason: string;
  actions: React.ReactNode;
}

const TONE: Record<Tone, string> = {
  red: 'bg-red-500/10 text-red-600 dark:text-red-400',
  amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  indigo: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
  teal: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
};

const toAction = (t: TaskRow): ActionTask => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, due_date: t.due_date, assignee_id: t.assignee_id });

export default async function Dashboard() {
  const ctx = await requireContext();
  const ws = ctx.workspace.id;
  const me = ctx.user.id;
  const nowIso = new Date().toISOString();

  const [{ data: tasks }, { data: upcoming }, { data: missed }, { data: activity }, health, members, { data: meetings }] = await Promise.all([
    ctx.supabase.from('action_items').select(TASK_SELECT).eq('workspace_id', ws),
    ctx.supabase.from('meetings').select('id,title,scheduled_at,status,meeting_participants(user_id),meeting_action_items(action_item_id)').eq('workspace_id', ws).eq('status', 'scheduled').gte('scheduled_at', nowIso).order('scheduled_at').limit(4),
    ctx.supabase.from('meeting_participants').select('meeting:meetings!inner(id,title,scheduled_at,status,workspace_id)').eq('user_id', me).eq('attended', false).eq('meeting.status', 'completed').eq('meeting.workspace_id', ws).limit(5),
    ctx.supabase.from('activity_events').select('id,action,metadata,target_type,target_id,created_at,actor:profiles(full_name)').eq('workspace_id', ws).order('created_at', { ascending: false }).limit(5),
    computeHealth(ctx.supabase, ws),
    getMembers(ctx),
    ctx.supabase.from('meetings').select('id,title').eq('workspace_id', ws).order('scheduled_at', { ascending: false }).limit(30),
  ]);

  const all = (tasks ?? []) as unknown as TaskRow[];
  const open = all.filter((t) => t.status !== 'done');
  const overdue = open.filter((t) => isOverdue(t.due_date, t.status));
  const mine = open.filter((t) => t.assignee_id === me);
  const isLead = can(ctx.role, 'task.manage_any');
  const isViewer = ctx.role === 'viewer';
  const owners = members.filter((m) => m.role !== 'viewer').map((m) => ({ id: m.user_id, name: m.full_name }));
  const canEdit = (t: TaskRow) => isLead || (!isViewer && (t.assignee_id === me || t.creator_id === me));
  const missedMeetings = ((missed ?? []) as unknown as { meeting: { id: string; title: string; scheduled_at: string } }[]).map((m) => m.meeting);
  const next = health.nextMeeting;
  const in48h = (d: string | null) => !!d && new Date(d).getTime() - Date.now() <= 48 * 3600_000 && new Date(d).getTime() >= Date.now();

  // ---------------------------------------------------------------- Needs your attention
  const items: AttentionItem[] = [];
  for (const m of missedMeetings) {
    items.push({
      key: `missed-${m.id}`, tone: 'indigo', icon: <Sparkles className="size-4" />,
      title: <>You missed <Link href={`/meetings/${m.id}`} className="hover:underline">“{m.title}”</Link></>,
      reason: `${fmtDate(m.scheduled_at)} · get the decisions and your tasks in a 1-minute brief`,
      actions: !isViewer && <Link href={`/briefs?meeting=${m.id}`} className={buttonVariants({ size: 'sm', variant: 'secondary' })}><Sparkles /> Get catch-up</Link>,
    });
  }
  for (const t of mine.filter((t) => isOverdue(t.due_date, t.status))) {
    items.push({
      key: `od-${t.id}`, tone: 'red', icon: <AlertTriangle className="size-4" />,
      title: <Link href={`/tasks/${t.id}`} className="hover:underline">{t.title}</Link>,
      reason: `Overdue since ${fmtDate(t.due_date)} · finish it or set a realistic deadline`,
      actions: <><CompleteButton task={toAction(t)} variant="default" /><DeadlineButton task={toAction(t)} label="Extend" /></>,
    });
  }
  for (const t of mine.filter((t) => t.status === 'blocked')) {
    items.push({
      key: `bl-${t.id}`, tone: 'amber', icon: <AlertTriangle className="size-4" />,
      title: <Link href={`/tasks/${t.id}`} className="hover:underline">{t.title}</Link>,
      reason: 'Blocked · unblock it, or hand it to someone who can move it',
      actions: <><StartButton task={toAction(t)} label="Unblock" /><Link href={`/handovers?task=${t.id}&from=${me}`} className={buttonVariants({ size: 'sm', variant: 'outline' })}><Repeat2 /> Hand over</Link></>,
    });
  }
  for (const t of mine.filter((t) => t.status === 'todo' && in48h(t.due_date))) {
    items.push({
      key: `ds-${t.id}`, tone: 'amber', icon: <Clock className="size-4" />,
      title: <Link href={`/tasks/${t.id}`} className="hover:underline">{t.title}</Link>,
      reason: `Due ${fmtDateTime(t.due_date)} and not started`,
      actions: <StartButton task={toAction(t)} />,
    });
  }
  if (isLead) {
    for (const t of open.filter((t) => !t.assignee_id)) {
      items.push({
        key: `un-${t.id}`, tone: 'red', icon: <UserX className="size-4" />,
        title: <Link href={`/tasks/${t.id}`} className="hover:underline">{t.title}</Link>,
        reason: `No owner${isOverdue(t.due_date, t.status) ? ' and overdue' : ''} · work without an owner silently stalls`,
        actions: <OwnerPicker task={toAction(t)} members={owners} editable compact />,
      });
    }
    for (const t of overdue.filter((t) => t.assignee_id && t.assignee_id !== me).slice(0, 3)) {
      items.push({
        key: `tod-${t.id}`, tone: 'red', icon: <AlertTriangle className="size-4" />,
        title: <Link href={`/tasks/${t.id}`} className="hover:underline">{t.title}</Link>,
        reason: `${t.assignee?.full_name ?? 'Owner'}'s task is overdue since ${fmtDate(t.due_date)}`,
        actions: <OwnerPicker task={toAction(t)} members={owners} editable compact />,
      });
    }
    if (next && health.agendaSuggestions.length > 0) {
      items.push({
        key: 'agenda', tone: 'teal', icon: <CalendarDays className="size-4" />,
        title: <>Prepare <Link href={`/meetings/${next.id}`} className="hover:underline">“{next.title}”</Link></>,
        reason: `${health.agendaSuggestions.length} at-risk task(s) aren't on its agenda yet · ${fmtDateTime(next.scheduled_at)}`,
        actions: <CarryButton meetingId={next.id} taskIds={health.agendaSuggestions.map((s) => s.task.id)} label={`Add ${health.agendaSuggestions.length} to agenda`} variant="default" />,
      });
    }
  }
  const attention = items.slice(0, 8);

  // ---------------------------------------------------------------- My work groups
  const weekEnd = Date.now() + 7 * 86_400_000;
  const groups = [
    { label: 'Overdue', tasks: mine.filter((t) => isOverdue(t.due_date, t.status)) },
    { label: 'Due this week', tasks: mine.filter((t) => !isOverdue(t.due_date, t.status) && t.due_date && new Date(t.due_date).getTime() <= weekEnd) },
    { label: 'Later / no deadline', tasks: mine.filter((t) => !isOverdue(t.due_date, t.status) && (!t.due_date || new Date(t.due_date).getTime() > weekEnd)) },
  ].filter((g) => g.tasks.length);

  const stats = [
    { label: 'Open tasks', value: open.length, sub: `${mine.length} assigned to you`, icon: CircleDot, href: '/tasks' },
    { label: 'Overdue', value: overdue.length, sub: overdue.length ? 'Needs action' : 'All on track', icon: AlertTriangle, href: '/tasks?filter=overdue', alert: overdue.length > 0 },
    { label: 'Upcoming meetings', value: upcoming?.length ?? 0, sub: next ? `Next: ${fmtDate(next.scheduled_at)}` : 'None scheduled', icon: CalendarDays, href: '/meetings' },
    { label: 'Completed', value: all.length - open.length, sub: 'With recorded outcomes', icon: CheckCircle2, href: '/tasks?status=done' },
  ];

  return (
    <div className="animate-in">
      <PageHeader
        title={`Good to see you, ${ctx.profile.full_name.split(' ')[0]}`}
        description={`${ctx.workspace.name} · ${isLead ? 'Team overview' : isViewer ? 'Read-only overview' : 'Your work at a glance'}`}
        actions={
          <>
            {can(ctx.role, 'meeting.create') && <NewMeetingButton members={owners} openTasks={open.map((t) => ({ id: t.id, title: t.title, status: t.status, due_date: t.due_date }))} selfId={me} />}
            {can(ctx.role, 'task.create') && <NewTaskButton members={owners} meetings={meetings ?? []} />}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="group">
            <Card className="p-4 transition-colors group-hover:border-foreground/20">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                {s.label}
                <s.icon className={cn('size-4', s.alert && 'text-red-500')} />
              </div>
              <p className={cn('mt-1 text-2xl font-semibold tabular-nums', s.alert && 'text-red-600 dark:text-red-400')}>{s.value}</p>
              <p className="mt-0.5 flex items-center justify-between text-[11px] text-muted-foreground">
                {s.sub}
                <ArrowRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
              </p>
            </Card>
          </Link>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Needs your attention */}
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Needs your attention</CardTitle>
                <p className="text-xs text-muted-foreground">{attention.length ? `${attention.length} thing${attention.length > 1 ? 's' : ''} to act on` : 'Nothing urgent right now'}</p>
              </div>
            </CardHeader>
            <CardContent className="p-0 pb-1">
              {attention.length === 0 ? (
                <div className="flex items-center gap-3 px-4 py-6 text-sm">
                  <CheckCircle2 className="size-5 text-emerald-500" />
                  <span>You’re all caught up. New risks and assignments will appear here.</span>
                </div>
              ) : (
                <ul className="divide-y">
                  {attention.map((it) => (
                    <li key={it.key} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                      <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full', TONE[it.tone])}>{it.icon}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{it.title}</p>
                        <p className="text-xs text-muted-foreground">{it.reason}</p>
                      </div>
                      {!isViewer && <div className="flex shrink-0 flex-wrap gap-1.5">{it.actions}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* My work */}
          {!isViewer && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>My open work</CardTitle>
                  <p className="text-xs text-muted-foreground">Click a status to change it · ••• for more actions</p>
                </div>
                <Link href="/tasks?filter=mine" className="text-xs text-muted-foreground hover:text-foreground">All my tasks →</Link>
              </CardHeader>
              <CardContent className="space-y-4">
                {groups.length === 0 && <p className="text-sm text-muted-foreground">Nothing assigned to you.</p>}
                {groups.map((g) => (
                  <div key={g.label}>
                    <p className={cn('mb-1 text-[11px] font-semibold uppercase tracking-wide', g.label === 'Overdue' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')}>
                      {g.label} · {g.tasks.length}
                    </p>
                    <ul className="divide-y rounded-md border">
                      {g.tasks.map((t) => (
                        <li key={t.id} className="flex items-center gap-3 px-3 py-2">
                          <StatusPill task={toAction(t)} editable={canEdit(t)} />
                          <div className="min-w-0 flex-1">
                            <Link href={`/tasks/${t.id}`} className="block truncate text-sm hover:underline">{t.title}</Link>
                            {t.meeting && <p className="truncate text-[11px] text-muted-foreground">from {t.meeting.title}</p>}
                          </div>
                          <PriorityBadge priority={t.priority} />
                          <span className={cn('w-20 text-right text-xs tabular-nums', isOverdue(t.due_date, t.status) ? 'font-medium text-red-600 dark:text-red-400' : 'text-muted-foreground')}>{fmtDate(t.due_date)}</span>
                          <TaskRowMenu task={toAction(t)} canEdit={canEdit(t)} carryTo={isLead ? next : null} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {/* Context health */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5"><HeartPulse className="size-4 text-primary" /> Context health</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <ScoreRing score={health.score} status={health.status} />
                <ul className="flex-1 space-y-1 text-xs">
                  {health.components.filter((c) => c.count > 0).slice(0, 4).map((c) => (
                    <li key={c.key} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{c.label}</span>
                      <span className="tabular-nums font-medium text-red-600 dark:text-red-400">−{c.penalty}</span>
                    </li>
                  ))}
                  {health.components.every((c) => c.count === 0) && <li className="text-muted-foreground">No risk signals.</li>}
                </ul>
              </div>
              {health.riskTasks.length > 0 && (
                <Link href="/continuity" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'mt-3 w-full')}>
                  Review {health.riskTasks.length} at-risk task{health.riskTasks.length > 1 ? 's' : ''} <ArrowRight />
                </Link>
              )}
              {health.riskTasks.length > 0 && (
                <ul className="mt-3 space-y-1.5 border-t pt-3">
                  {health.riskTasks.slice(0, 3).map((r) => (
                    <li key={r.id} className="text-xs">
                      <Link href={`/tasks/${r.id}`} className="block truncate font-medium hover:underline">{r.title}</Link>
                      <span className="text-muted-foreground">{r.signals.map((s) => SIGNAL_LABEL[s]).join(' · ')}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Upcoming meetings */}
          <Card>
            <CardHeader>
              <CardTitle>Upcoming meetings</CardTitle>
              <Link href="/meetings" className="text-xs text-muted-foreground hover:text-foreground">All →</Link>
            </CardHeader>
            <CardContent>
              {(upcoming ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
              ) : (
                <ul className="space-y-2">
                  {((upcoming ?? []) as unknown as { id: string; title: string; scheduled_at: string; meeting_participants: { user_id: string }[]; meeting_action_items: { action_item_id: string }[] }[]).map((m) => {
                    const d = new Date(m.scheduled_at);
                    return (
                      <li key={m.id}>
                        <Link href={`/meetings/${m.id}`} className="group flex items-center gap-3 rounded-md border p-2 hover:bg-accent/50">
                          <div className="flex w-11 shrink-0 flex-col items-center rounded bg-muted py-1 leading-none">
                            <span className="text-[10px] uppercase text-muted-foreground">{d.toLocaleDateString('en-IN', { month: 'short', timeZone: 'Asia/Kolkata' })}</span>
                            <span className="text-base font-semibold">{d.toLocaleDateString('en-IN', { day: 'numeric', timeZone: 'Asia/Kolkata' })}</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{m.title}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })} · {m.meeting_participants.length} people · {m.meeting_action_items.length} on agenda
                            </p>
                          </div>
                          <span className="text-xs text-muted-foreground group-hover:text-foreground">Prepare →</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Recent activity */}
          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
              <Link href="/activity" className="text-xs text-muted-foreground hover:text-foreground">All →</Link>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2.5">
                {((activity ?? []) as unknown as { id: string; action: string; metadata: Record<string, unknown>; target_type: string; target_id: string | null; created_at: string; actor: { full_name: string } | null }[]).map((a) => {
                  const href = activityHref(a);
                  return (
                    <li key={a.id} className="flex gap-2 text-xs">
                      <Avatar name={a.actor?.full_name} className="mt-0.5 size-5 text-[9px]" />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2">
                          <span className="font-medium">{a.actor?.full_name?.split(' ')[0] ?? 'System'}</span>{' '}
                          {href ? <Link href={href} className="text-muted-foreground hover:text-foreground hover:underline">{activityText(a)}</Link> : <span className="text-muted-foreground">{activityText(a)}</span>}
                        </p>
                        <p className="text-[10px] text-muted-foreground">{relTime(a.created_at)}</p>
                      </div>
                    </li>
                  );
                })}
                {(activity ?? []).length === 0 && <li className="text-sm text-muted-foreground">No activity yet.</li>}
              </ul>
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}
