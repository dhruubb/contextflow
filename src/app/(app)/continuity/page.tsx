import Link from 'next/link';
import { ArrowRightLeft, CheckCircle2, ChevronDown, Repeat2, Sparkles } from 'lucide-react';
import { requireContext } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { computeHealth, type RiskTask } from '@/lib/continuity';
import { getMembers } from '@/lib/queries';
import { whyText, severity } from '@/lib/task-insight';
import { Card, buttonVariants } from '@/components/ui';
import { ScoreRing } from '@/components/score-ring';
import { CarryButton, CompleteButton, DeadlineButton, OwnerPicker, StartButton, TaskRowMenu, type ActionTask } from '@/components/task-actions';
import { cn, relTime } from '@/lib/utils';
import { AiAnalysis } from './continuity-client';

export const metadata = { title: 'Continuity Engine' };

const TZ = 'Asia/Kolkata';
const HEADLINE = {
  healthy: 'Everything is on track.',
  moderate: 'A few tasks are slipping.',
  critical: 'Work is falling through the cracks.',
};

export default async function ContinuityPage() {
  const ctx = await requireContext();
  const me = ctx.user.id;
  const [report, members] = await Promise.all([computeHealth(ctx.supabase, ctx.workspace.id), getMembers(ctx)]);

  const { data: events } = await ctx.supabase
    .from('task_events')
    .select('event_type,created_at,task:action_items!inner(id,title,workspace_id),actor:profiles(full_name)')
    .eq('task.workspace_id', ctx.workspace.id)
    .in('event_type', ['reassigned', 'handed_over', 'carried_forward', 'closed'])
    .order('created_at', { ascending: false })
    .limit(6);

  const isLead = can(ctx.role, 'task.manage_any');
  const isViewer = ctx.role === 'viewer';
  const canCarry = can(ctx.role, 'meeting.carry_forward');
  const owners = members.filter((m) => m.role !== 'viewer').map((m) => ({ id: m.user_id, name: m.full_name }));
  const next = report.nextMeeting;
  const notOnAgenda = new Set(report.agendaSuggestions.map((s) => s.task.id));
  const toAction = (t: RiskTask): ActionTask => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, due_date: t.due_date, assignee_id: t.assignee_id });
  const canEdit = (t: RiskTask) => isLead || (!isViewer && (t.assignee_id === me || t.creator_id === me));

  const counts = [
    { label: 'Overdue', value: report.totals.overdue },
    { label: 'Blocked', value: report.totals.blocked },
    { label: 'No owner', value: report.totals.unassigned },
    { label: 'Due soon', value: report.components.find((c) => c.key === 'dueSoon')?.count ?? 0 },
  ];

  /** The best one or two fixes for a task, given who is looking. */
  function fixes(t: RiskTask) {
    const a = toAction(t);
    const s = new Set(t.signals);
    if (s.has('unassigned')) return isLead ? [<OwnerPicker key="a" task={a} members={owners} editable compact primary />] : [];
    if (s.has('blocked') && canEdit(t))
      return [<StartButton key="u" task={a} label="Unblock" variant="default" />, t.assignee_id && <Link key="h" href={`/handovers?task=${t.id}&from=${t.assignee_id}`} className={buttonVariants({ size: 'sm', variant: 'ghost' })}><Repeat2 /> Hand over</Link>];
    if (s.has('overdue')) {
      if (t.assignee_id === me) return [<CompleteButton key="c" task={a} variant="default" />, <DeadlineButton key="d" task={a} label="New date" variant="ghost" />];
      if (isLead) return [<OwnerPicker key="r" task={a} members={owners} editable compact primary={false} />, <DeadlineButton key="d" task={a} label="New date" variant="ghost" />];
    }
    if (s.has('dueSoon') && canEdit(t)) return [<StartButton key="s" task={a} variant="default" />];
    if (s.has('missedOwner') && t.assignee_id === me && t.source_meeting_id) return [<Link key="b" href={`/briefs?meeting=${t.source_meeting_id}`} className={buttonVariants({ size: 'sm', variant: 'secondary' })}><Sparkles /> Catch up</Link>];
    return [];
  }

  return (
    <div className="animate-in space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Continuity Engine</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Spots work that is slipping through the cracks, and how to fix it.</p>
        </div>
      </div>

      {/* Summary */}
      <Card>
        <div className="flex flex-col gap-6 p-5 md:flex-row md:items-center">
          <ScoreRing score={report.score} status={report.status} size={96} />
          <div className="flex-1">
            <p className="text-lg font-semibold tracking-tight">{HEADLINE[report.status]}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {report.riskTasks.length === 0
                ? 'No task is overdue, blocked or without an owner.'
                : <>{report.riskTasks.length} task{report.riskTasks.length > 1 ? 's need' : ' needs'} attention{next && <> before <Link href={`/meetings/${next.id}`} className="font-medium text-foreground hover:underline">{next.title}</Link> ({new Date(next.scheduled_at).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: TZ })})</>}.</>}
            </p>
          </div>
          <div className="grid grid-cols-4 gap-2 md:w-[340px]">
            {counts.map((c) => (
              <div key={c.label} className="rounded-md border px-2 py-2 text-center">
                <p className={cn('text-xl font-semibold tabular-nums', c.value > 0 ? 'text-foreground' : 'text-muted-foreground/50')}>{c.value}</p>
                <p className="text-[11px] text-muted-foreground">{c.label}</p>
              </div>
            ))}
          </div>
        </div>
        <details className="group border-t">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-5 py-2.5 text-xs text-muted-foreground hover:text-foreground">
            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" /> How the score works
          </summary>
          <div className="grid gap-x-8 gap-y-1.5 px-5 pb-4 text-xs sm:grid-cols-2">
            <p className="text-muted-foreground sm:col-span-2">Start at 100. Each at-risk task takes points off (with a cap per type). Same data, same score — AI never changes it.</p>
            {report.components.map((c) => (
              <div key={c.key} className="flex justify-between border-b border-dashed py-1">
                <span>{c.label} <span className="text-muted-foreground">({c.count})</span></span>
                <span className={cn('tabular-nums', c.penalty ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')}>−{c.penalty}</span>
              </div>
            ))}
          </div>
        </details>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Action list */}
        <Card className="lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3.5">
            <div>
              <h2 className="text-sm font-semibold">What to fix</h2>
              <p className="text-xs text-muted-foreground">Most urgent first</p>
            </div>
            {canCarry && next && report.agendaSuggestions.length > 0 && (
              <CarryButton meetingId={next.id} taskIds={report.agendaSuggestions.map((s) => s.task.id)} label={`Add all ${report.agendaSuggestions.length} to next meeting`} />
            )}
          </div>
          {report.riskTasks.length === 0 ? (
            <div className="flex items-center gap-3 px-5 py-10 text-sm text-muted-foreground"><CheckCircle2 className="size-5 text-emerald-500" /> Nothing to fix right now.</div>
          ) : (
            <ul className="divide-y">
              {report.riskTasks.map((t) => {
                const f = fixes(t).filter(Boolean);
                return (
                  <li key={t.id} className="flex items-center gap-3 px-5 py-3.5">
                    <span className={cn('size-2 shrink-0 rounded-full', severity(t.signals) === 'high' ? 'bg-red-500' : 'bg-amber-500')} />
                    <div className="min-w-0 flex-1">
                      <Link href={`/tasks/${t.id}`} className="block truncate text-sm font-medium hover:underline">{t.title}</Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {t.assignee_name ?? 'Unassigned'} · {whyText(t, { isOwner: t.assignee_id === me })}
                        {next && !notOnAgenda.has(t.id) && <span className="text-teal-700 dark:text-teal-400"> · on next agenda</span>}
                      </p>
                    </div>
                    {!isViewer && f.length > 0 && <div className="flex shrink-0 items-center gap-1">{f}</div>}
                    {!isViewer && <TaskRowMenu task={toAction(t)} canEdit={canEdit(t)} carryTo={canCarry && next && notOnAgenda.has(t.id) ? { id: next.id, title: next.title } : null} />}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Right column */}
        <div className="space-y-5">
          {can(ctx.role, 'continuity.analyze') && <AiAnalysis canCarry={canCarry} nextMeeting={next} titles={Object.fromEntries(report.riskTasks.map((t) => [t.id, t.title]))} />}
          <Card>
            <div className="border-b px-5 py-3.5"><h2 className="text-sm font-semibold">Recent changes</h2></div>
            <ul className="space-y-3 px-5 py-4">
              {((events ?? []) as unknown as { event_type: string; created_at: string; task: { id: string; title: string }; actor: { full_name: string } | null }[]).map((e, i) => {
                const verb = { reassigned: 'reassigned', handed_over: 'handed over', carried_forward: 'moved to next meeting', closed: 'completed' }[e.event_type] ?? e.event_type;
                return (
                  <li key={i} className="flex gap-2.5 text-xs">
                    {e.event_type === 'closed' ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" /> : e.event_type === 'carried_forward' ? <ArrowRightLeft className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /> : <Repeat2 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
                    <div className="min-w-0">
                      <p className="leading-snug"><Link href={`/tasks/${e.task.id}`} className="font-medium hover:underline">{e.task.title}</Link> <span className="text-muted-foreground">{verb}</span></p>
                      <p className="text-[11px] text-muted-foreground/70">{e.actor?.full_name?.split(' ')[0]} · {relTime(e.created_at)}</p>
                    </div>
                  </li>
                );
              })}
              {(events ?? []).length === 0 && <li className="text-sm text-muted-foreground">No changes yet.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
