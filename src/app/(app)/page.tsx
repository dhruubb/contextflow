import Link from 'next/link';
import { ArrowRight, CalendarDays, CheckCircle2, Repeat2, Sparkles, TrendingDown, TrendingUp, Users } from 'lucide-react';
import { requireContext } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { computeHealth, type RiskTask } from '@/lib/continuity';
import { getNavBadges } from '@/lib/nav-badges';
import { getMembers, TASK_SELECT, activityHref, activityText, type TaskRow } from '@/lib/queries';
import { whyText, severity } from '@/lib/task-insight';
import { Avatar, Card, buttonVariants } from '@/components/ui';
import { CarryButton, CompleteButton, DeadlineButton, OwnerPicker, StartButton, StatusPill, TaskRowMenu, type ActionTask } from '@/components/task-actions';
import { DashboardCalendar, type CalendarEvent } from '@/components/dashboard-calendar';
import { NewTaskButton } from './tasks/task-client';
import { NewMeetingButton } from './meetings/new-meeting';
import { cn, fmtDate, isOverdue, relTime } from '@/lib/utils';

export const metadata = { title: 'Dashboard' };

const TZ = 'Asia/Kolkata';
const fmtWhen = (d: string) =>
  new Date(d).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: TZ });

function Section({ title, count, children, action }: { title: string; count?: number; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center justify-between px-5 pb-2 pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
          {count !== undefined && <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">{count}</span>}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export default async function Dashboard() {
  const ctx = await requireContext();
  const ws = ctx.workspace.id;
  const me = ctx.user.id;
  const first = ctx.profile.full_name.split(' ')[0];
  const isLead = can(ctx.role, 'task.manage_any');
  const isViewer = ctx.role === 'viewer';

  const windowStart = new Date(Date.now() - 180 * 86_400_000).toISOString();
  const windowEnd = new Date(Date.now() + 180 * 86_400_000).toISOString();
  const [{ data: tasks }, { data: upcoming }, { data: missed }, { data: activity }, health, members, { data: meetings }, { data: calMeetings }] = await Promise.all([
    ctx.supabase.from('action_items').select(TASK_SELECT).eq('workspace_id', ws),
    ctx.supabase.from('meetings').select('id,title,scheduled_at,meeting_participants(user_id),meeting_action_items(action_item_id)').eq('workspace_id', ws).eq('status', 'scheduled').gte('scheduled_at', new Date().toISOString()).order('scheduled_at').limit(3),
    ctx.supabase.from('meeting_participants').select('meeting:meetings!inner(id,title,scheduled_at,status,workspace_id)').eq('user_id', me).eq('attended', false).eq('meeting.status', 'completed').eq('meeting.workspace_id', ws).limit(3),
    ctx.supabase.from('activity_events').select('id,action,metadata,target_type,target_id,created_at,actor:profiles(full_name)').eq('workspace_id', ws).order('created_at', { ascending: false }).limit(6),
    computeHealth(ctx.supabase, ws),
    getMembers(ctx),
    ctx.supabase.from('meetings').select('id,title').eq('workspace_id', ws).order('scheduled_at', { ascending: false }).limit(30),
    ctx.supabase.from('meetings').select('id,title,scheduled_at,status,meeting_participants(user_id,attended)').eq('workspace_id', ws).gte('scheduled_at', windowStart).lte('scheduled_at', windowEnd),
  ]);

  const trend = (await getNavBadges(ctx).catch(() => null))?.performance;
  const all = (tasks ?? []) as unknown as TaskRow[];
  const open = all.filter((t) => t.status !== 'done');
  const mine = open.filter((t) => t.assignee_id === me);
  const owners = members.filter((m) => m.role !== 'viewer').map((m) => ({ id: m.user_id, name: m.full_name }));
  const risk = new Map(health.riskTasks.map((r) => [r.id, r]));
  const myRisk = health.riskTasks.filter((r) => r.assignee_id === me);
  const myCalm = mine.filter((t) => !risk.has(t.id)).sort((a, b) => (a.due_date ?? '9').localeCompare(b.due_date ?? '9'));
  const teamRisk = isLead ? health.riskTasks.filter((r) => r.assignee_id !== me) : [];
  const missedMeetings = ((missed ?? []) as unknown as { meeting: { id: string; title: string; scheduled_at: string } }[]).map((m) => m.meeting);
  const nextMeetings = (upcoming ?? []) as unknown as { id: string; title: string; scheduled_at: string; meeting_participants: { user_id: string }[]; meeting_action_items: { action_item_id: string }[] }[];
  const next = nextMeetings[0];
  const overdueCount = open.filter((t) => isOverdue(t.due_date, t.status)).length;
  const calendarEvents: CalendarEvent[] = [
    ...((calMeetings ?? []) as unknown as { id: string; title: string; scheduled_at: string; status: string; meeting_participants: { user_id: string; attended: boolean }[] }[]).map((m) => ({
      id: m.id, type: 'meeting' as const, title: m.title, at: m.scheduled_at, status: m.status,
      missed: m.status === 'completed' && m.meeting_participants.some((p) => p.user_id === me && !p.attended),
    })),
    ...all.filter((t) => t.due_date && (isLead || isViewer || t.assignee_id === me)).map((t) => ({ id: t.id, type: 'task' as const, title: t.title, at: t.due_date!, status: t.status })),
  ];

  const toAction = (t: { id: string; title: string; status: string; priority: string; due_date: string | null; assignee_id: string | null }): ActionTask => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, due_date: t.due_date, assignee_id: t.assignee_id });

  /** The one or two buttons that resolve this task's problem. */
  function fixes(r: RiskTask) {
    const a = toAction(r);
    const s = new Set(r.signals);
    const mineTask = r.assignee_id === me;
    if (s.has('unassigned')) return isLead ? [<OwnerPicker key="a" task={a} members={owners} editable compact primary />] : [];
    if (!mineTask && isLead) return [<OwnerPicker key="r" task={a} members={owners} editable compact primary={false} />];
    if (s.has('blocked')) return [<StartButton key="u" task={a} resume variant="default" />, <Link key="h" href={`/handovers?task=${r.id}&from=${r.assignee_id}`} className={buttonVariants({ size: 'sm', variant: 'ghost' })}><Repeat2 /> Hand over</Link>];
    if (s.has('overdue')) return [<CompleteButton key="c" task={a} variant="default" />, <DeadlineButton key="e" task={a} label="New date" variant="ghost" />];
    if (s.has('dueSoon')) return [<StartButton key="s" task={a} variant="default" />];
    if (s.has('missedOwner') && r.source_meeting_id) return [<Link key="b" href={`/briefs?meeting=${r.source_meeting_id}`} className={buttonVariants({ size: 'sm', variant: 'secondary' })}><Sparkles /> Catch up</Link>];
    return [];
  }

  const RiskRow = ({ r, showOwner }: { r: RiskTask; showOwner?: boolean }) => (
    <li className="flex items-center gap-3 px-5 py-3">
      <span className={cn('size-2 shrink-0 rounded-full', severity(r.signals) === 'high' ? 'bg-red-500' : 'bg-amber-500')} />
      <div className="min-w-0 flex-1">
        <Link href={`/tasks/${r.id}`} className="block truncate text-sm font-medium hover:underline">{r.title}</Link>
        <p className="truncate text-xs text-muted-foreground">
          {showOwner && <>{r.assignee_name ?? 'Unassigned'} · </>}
          {whyText(r, { isOwner: r.assignee_id === me })}
        </p>
      </div>
      {!isViewer && <div className="flex shrink-0 items-center gap-1">{fixes(r)}</div>}
      {!isViewer && <TaskRowMenu task={toAction(r)} canEdit={isLead || r.assignee_id === me || r.creator_id === me} carryTo={isLead && next ? { id: next.id, title: next.title } : null} />}
    </li>
  );

  const stats = [
    { label: 'My open tasks', value: String(mine.length), sub: myRisk.length ? `${myRisk.length} need action` : 'All on track', href: '/tasks?filter=mine', alert: myRisk.length > 0 },
    { label: 'Overdue (team)', value: String(overdueCount), sub: overdueCount ? 'Past their deadline' : 'Nothing overdue', href: '/tasks?filter=overdue', alert: overdueCount > 0 },
    { label: 'Next meeting', value: next ? new Date(next.scheduled_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: TZ }) : '—', sub: next?.title ?? 'Nothing scheduled', href: next ? `/meetings/${next.id}` : '/meetings' },
    { label: 'Performance', value: `${health.score}`, suffix: '/100', sub: health.status === 'healthy' ? 'Good' : health.status === 'moderate' ? 'Fair — some work is slipping' : 'At risk — act now', href: '/performance', alert: health.status === 'critical', trend: trend?.delta ?? null },
  ];

  return (
    <div className="animate-in space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ })} · {ctx.workspace.name}</p>
          <h1 className="mt-0.5 text-xl font-semibold tracking-tight">Hi {first}, here’s your day</h1>
        </div>
        <div className="flex gap-2">
          {can(ctx.role, 'meeting.create') && <NewMeetingButton members={owners} openTasks={open.map((t) => ({ id: t.id, title: t.title, status: t.status, due_date: t.due_date }))} selfId={me} />}
          {can(ctx.role, 'task.create') && <NewTaskButton members={owners} meetings={meetings ?? []} />}
        </div>
      </div>

      {/* Missed meetings */}
      {missedMeetings.map((m) => (
        <div key={m.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-indigo-500/25 bg-indigo-500/[0.06] px-4 py-3">
          <Sparkles className="size-4 text-indigo-500" />
          <p className="flex-1 text-sm">
            You missed <Link href={`/meetings/${m.id}`} className="font-medium hover:underline">{m.title}</Link>
            <span className="text-muted-foreground"> on {fmtDate(m.scheduled_at)}. Get the decisions and your tasks in one minute.</span>
          </p>
          {!isViewer && <Link href={`/briefs?meeting=${m.id}`} className={buttonVariants({ size: 'sm', variant: 'secondary' })}>Catch me up</Link>}
        </div>
      ))}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="group">
            <Card className="h-full p-4 transition-colors group-hover:border-foreground/20">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={cn('mt-1 text-2xl font-semibold tabular-nums tracking-tight', s.alert && 'text-red-600 dark:text-red-400')}>
                {s.value}
                {s.suffix && <span className="text-sm font-normal text-muted-foreground">{s.suffix}</span>}
                {'trend' in s && s.trend ? (
                  <span className={cn('ml-2 inline-flex items-center gap-0.5 text-sm font-semibold', s.trend > 0 ? 'text-emerald-500' : 'text-red-500')}>
                    {s.trend > 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
                    {s.trend > 0 ? '+' : ''}{s.trend}
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{s.sub}</p>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* My tasks */}
          {!isViewer && (
            <Card>
              <div className="flex items-center justify-between border-b px-5 py-3.5">
                <h2 className="text-sm font-semibold">My tasks</h2>
                <Link href="/tasks?filter=mine" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">View all <ArrowRight className="size-3" /></Link>
              </div>
              {mine.length === 0 ? (
                <div className="flex items-center gap-3 px-5 py-8 text-sm text-muted-foreground"><CheckCircle2 className="size-5 text-emerald-500" /> Nothing assigned to you right now.</div>
              ) : (
                <>
                  {myRisk.length > 0 && (
                    <Section title="Needs action" count={myRisk.length}>
                      <ul className="divide-y border-y">{myRisk.map((r) => <RiskRow key={r.id} r={r} />)}</ul>
                    </Section>
                  )}
                  {myCalm.length > 0 && (
                    <Section title="Coming up" count={myCalm.length}>
                      <ul className="divide-y border-t">
                        {myCalm.map((t) => (
                          <li key={t.id} className="flex items-center gap-3 px-5 py-3">
                            <span className="size-2 shrink-0 rounded-full bg-muted-foreground/30" />
                            <div className="min-w-0 flex-1">
                              <Link href={`/tasks/${t.id}`} className="block truncate text-sm font-medium hover:underline">{t.title}</Link>
                              <p className="truncate text-xs text-muted-foreground">{t.due_date ? `Due ${fmtDate(t.due_date)}` : 'No deadline'}{t.meeting && ` · from ${t.meeting.title}`}</p>
                            </div>
                            <StatusPill task={toAction(t)} editable />
                            <TaskRowMenu task={toAction(t)} canEdit carryTo={isLead && next ? { id: next.id, title: next.title } : null} />
                          </li>
                        ))}
                      </ul>
                    </Section>
                  )}
                  {myRisk.length === 0 && <p className="flex items-center gap-2 border-t px-5 py-3 text-xs text-muted-foreground"><CheckCircle2 className="size-4 text-emerald-500" /> Nothing urgent — you’re on track.</p>}
                </>
              )}
            </Card>
          )}

          {/* Team (leads) / at-risk (viewers) */}
          {(isLead || isViewer) && (
            <Card>
              <div className="flex items-center justify-between border-b px-5 py-3.5">
                <h2 className="flex items-center gap-2 text-sm font-semibold"><Users className="size-4 text-muted-foreground" /> {isViewer ? 'Work at risk' : 'Team work that needs you'}</h2>
                <Link href="/performance" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">Performance <ArrowRight className="size-3" /></Link>
              </div>
              {(isViewer ? health.riskTasks : teamRisk).length === 0 && !(isLead && next && health.agendaSuggestions.length) ? (
                <div className="flex items-center gap-3 px-5 py-6 text-sm text-muted-foreground"><CheckCircle2 className="size-5 text-emerald-500" /> The team is on track.</div>
              ) : (
                <ul className="divide-y">
                  {(isViewer ? health.riskTasks : teamRisk).map((r) => <RiskRow key={r.id} r={r} showOwner />)}
                  {isLead && next && health.agendaSuggestions.length > 0 && (
                    <li className="flex items-center gap-3 px-5 py-3">
                      <CalendarDays className="size-4 shrink-0 text-teal-600 dark:text-teal-400" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">Prepare “{next.title}”</p>
                        <p className="text-xs text-muted-foreground">{health.agendaSuggestions.length} unresolved task{health.agendaSuggestions.length > 1 ? 's are' : ' is'} not on the agenda yet</p>
                      </div>
                      <CarryButton meetingId={next.id} taskIds={health.agendaSuggestions.map((s) => s.task.id)} label="Add to agenda" variant="default" />
                    </li>
                  )}
                </ul>
              )}
            </Card>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-5">
          <Card>
            <div className="flex items-center justify-between border-b px-5 py-3.5">
              <h2 className="text-sm font-semibold">Calendar</h2>
              <Link href="/meetings" className="text-xs text-muted-foreground hover:text-foreground">All meetings</Link>
            </div>
            {next && (
              <Link href={`/meetings/${next.id}`} className="flex items-center gap-3 border-b bg-indigo-500/[0.04] px-5 py-3 hover:bg-indigo-500/[0.08]">
                <CalendarDays className="size-4 shrink-0 text-indigo-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400">Next · {fmtWhen(next.scheduled_at)}</p>
                  <p className="truncate text-sm font-medium">{next.title}</p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{next.meeting_action_items.length} on agenda <ArrowRight className="inline size-3" /></span>
              </Link>
            )}
            <DashboardCalendar events={calendarEvents} />
          </Card>

          <Card>
            <div className="flex items-center justify-between border-b px-5 py-3.5">
              <h2 className="text-sm font-semibold">Recent activity</h2>
              <Link href="/activity" className="text-xs text-muted-foreground hover:text-foreground">All</Link>
            </div>
            <ul className="space-y-3 px-5 py-4">
              {((activity ?? []) as unknown as { id: string; action: string; metadata: Record<string, unknown>; target_type: string; target_id: string | null; created_at: string; actor: { full_name: string } | null }[]).map((a) => {
                const href = activityHref(a);
                return (
                  <li key={a.id} className="flex gap-2.5 text-xs">
                    <Avatar name={a.actor?.full_name} className="size-5 text-[9px]" />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 leading-snug">
                        <span className="font-medium">{a.actor?.full_name?.split(' ')[0] ?? 'System'}</span>{' '}
                        {href ? <Link href={href} className="text-muted-foreground hover:text-foreground">{activityText(a)}</Link> : <span className="text-muted-foreground">{activityText(a)}</span>}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground/70">{relTime(a.created_at)}</p>
                    </div>
                  </li>
                );
              })}
              {(activity ?? []).length === 0 && <li className="text-sm text-muted-foreground">No activity yet.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
