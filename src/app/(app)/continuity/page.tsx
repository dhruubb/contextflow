import Link from 'next/link';
import { CheckCircle2, ChevronDown, HeartPulse, Repeat2, Sparkles } from 'lucide-react';
import { requireContext } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { computeHealth, SIGNAL_LABEL, type RiskTask, type SignalKey } from '@/lib/continuity';
import { getMembers } from '@/lib/queries';
import { PageHeader } from '@/components/shell';
import { Avatar, Badge, Card, CardContent, CardHeader, CardTitle, buttonVariants } from '@/components/ui';
import { PriorityBadge } from '@/components/badges';
import { ScoreRing } from '@/components/score-ring';
import { Timeline, type TimelineItem } from '@/components/timeline';
import { CarryButton, CompleteButton, DeadlineButton, OwnerPicker, StartButton, StatusPill, type ActionTask } from '@/components/task-actions';
import { cn, fmtDate, fmtDateTime } from '@/lib/utils';
import { AiAnalysis } from './continuity-client';

export const metadata = { title: 'Context Continuity Engine' };

const SIGNAL_TONE: Record<SignalKey, 'red' | 'amber'> = { overdue: 'red', unassigned: 'red', blocked: 'amber', carried: 'amber', dueSoon: 'amber', missedOwner: 'amber' };
const VERDICT = {
  healthy: 'Context is flowing well. Keep an eye on the items below.',
  moderate: 'Some work is at risk of losing context. Clear the actions below before the next meeting.',
  critical: 'Context is breaking down. Several tasks are stalled, ownerless or overdue — act now.',
};

export default async function ContinuityPage() {
  const ctx = await requireContext();
  const me = ctx.user.id;
  const [report, members] = await Promise.all([computeHealth(ctx.supabase, ctx.workspace.id), getMembers(ctx)]);

  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [{ data: events }, { data: decisions }] = await Promise.all([
    ctx.supabase
      .from('task_events')
      .select('event_type,notes,created_at,task:action_items!inner(id,title,workspace_id),actor:profiles(full_name)')
      .eq('task.workspace_id', ctx.workspace.id)
      .in('event_type', ['created', 'reassigned', 'handed_over', 'carried_forward', 'closed'])
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(15),
    ctx.supabase.from('decisions').select('title,created_at,meeting:meetings(id,title)').eq('workspace_id', ctx.workspace.id).gte('created_at', since).order('created_at', { ascending: false }).limit(8),
  ]);
  const kindOf: Record<string, TimelineItem['kind']> = { created: 'created', reassigned: 'reassigned', handed_over: 'handover', carried_forward: 'carried', closed: 'closed' };
  const verb: Record<string, string> = { created: 'created', reassigned: 'reassigned', handed_over: 'handed over', carried_forward: 'carried forward', closed: 'completed' };
  const timeline: TimelineItem[] = [
    ...((events ?? []) as unknown as { event_type: string; notes: string | null; created_at: string; task: { id: string; title: string }; actor: { full_name: string } | null }[]).map((e) => ({
      at: e.created_at, kind: kindOf[e.event_type], title: `“${e.task.title}” ${verb[e.event_type]}`,
      detail: e.event_type === 'closed' && e.notes ? `Outcome: ${e.notes}` : null, actor: e.actor?.full_name, href: `/tasks/${e.task.id}`,
    })),
    ...((decisions ?? []) as unknown as { title: string; created_at: string; meeting: { id: string; title: string } | null }[]).map((d) => ({
      at: d.created_at, kind: 'decision' as const, title: `Decision: ${d.title}`, detail: d.meeting ? `in “${d.meeting.title}”` : null, href: d.meeting ? `/meetings/${d.meeting.id}` : undefined,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);

  const isLead = can(ctx.role, 'task.manage_any');
  const isViewer = ctx.role === 'viewer';
  const canCarry = can(ctx.role, 'meeting.carry_forward');
  const owners = members.filter((m) => m.role !== 'viewer').map((m) => ({ id: m.user_id, name: m.full_name }));
  const notOnAgenda = new Set(report.agendaSuggestions.map((s) => s.task.id));
  const next = report.nextMeeting;
  const active = report.components.filter((c) => c.count > 0);
  const recoverable = active.reduce((a, c) => a + c.penalty, 0);

  const toAction = (t: RiskTask): ActionTask => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, due_date: t.due_date, assignee_id: t.assignee_id });
  const canEdit = (t: RiskTask) => isLead || (!isViewer && (t.assignee_id === me || t.creator_id === me));

  /** The single most useful next step per task, plus secondary actions. */
  function actionsFor(t: RiskTask) {
    const a = toAction(t);
    const out: React.ReactNode[] = [];
    const s = new Set(t.signals);
    if (s.has('unassigned') && isLead) out.push(<OwnerPicker key="own" task={a} members={owners} editable compact />);
    if (s.has('blocked') && canEdit(t)) {
      out.push(<StartButton key="unb" task={a} label="Unblock" />);
      if (t.assignee_id) out.push(<Link key="ho" href={`/handovers?task=${t.id}&from=${t.assignee_id}`} className={buttonVariants({ size: 'sm', variant: 'outline' })}><Repeat2 /> Hand over</Link>);
    }
    if (s.has('overdue') && canEdit(t) && !s.has('unassigned')) {
      if (t.assignee_id === me) out.push(<CompleteButton key="done" task={a} />);
      out.push(<DeadlineButton key="dl" task={a} label="Extend" />);
    }
    if (s.has('overdue') && isLead && t.assignee_id && t.assignee_id !== me) out.push(<OwnerPicker key="re" task={a} members={owners} editable compact />);
    if (s.has('dueSoon') && canEdit(t) && t.status === 'todo') out.push(<StartButton key="st" task={a} />);
    if (s.has('missedOwner') && t.source_meeting_id) {
      out.push(
        t.assignee_id === me
          ? <Link key="cu" href={`/briefs?meeting=${t.source_meeting_id}`} className={buttonVariants({ size: 'sm', variant: 'secondary' })}><Sparkles /> My catch-up</Link>
          : <Link key="mt" href={`/meetings/${t.source_meeting_id}`} className={buttonVariants({ size: 'sm', variant: 'outline' })}>Open meeting</Link>,
      );
    }
    if (canCarry && next && notOnAgenda.has(t.id)) out.push(<CarryButton key="cf" meetingId={next.id} taskIds={[t.id]} label="Add to agenda" />);
    return out;
  }

  const why = (t: RiskTask) => {
    const parts: string[] = [];
    if (t.signals.includes('overdue')) parts.push(`was due ${fmtDate(t.due_date)}`);
    if (t.signals.includes('dueSoon')) parts.push(`due ${fmtDateTime(t.due_date)}, still To Do`);
    if (t.signals.includes('unassigned')) parts.push('nobody owns it');
    if (t.signals.includes('blocked')) parts.push('marked blocked');
    if (t.signals.includes('missedOwner')) parts.push(`${t.assignee_name?.split(' ')[0] ?? 'owner'} missed “${t.source_meeting_title}”`);
    if (t.signals.includes('carried')) parts.push(`carried ${t.carry_count}×`);
    return parts.join(' · ');
  };

  return (
    <div className="animate-in">
      <PageHeader
        title="Context Continuity Engine"
        description="Finds where context is getting lost — and gives you one-click fixes before the next meeting."
        actions={canCarry && next && report.agendaSuggestions.length > 0 && (
          <CarryButton meetingId={next.id} taskIds={report.agendaSuggestions.map((s) => s.task.id)} label={`Add ${report.agendaSuggestions.length} to next meeting`} variant="default" />
        )}
      />

      {/* Summary */}
      <Card className="mb-4">
        <div className="flex flex-col gap-5 p-5 md:flex-row md:items-center">
          <ScoreRing score={report.score} status={report.status} size={104} />
          <div className="flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Context health</p>
            <p className="mt-0.5 text-base font-medium">{VERDICT[report.status]}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {report.riskTasks.length} task{report.riskTasks.length === 1 ? '' : 's'} at risk
              {recoverable > 0 && <> · fixing them recovers up to <span className="font-medium text-foreground">+{recoverable} points</span></>}
              {next && <> · next meeting <Link href={`/meetings/${next.id}`} className="underline underline-offset-2">{next.title}</Link> on {fmtDateTime(next.scheduled_at)}</>}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {active.map((c) => (
                <Badge key={c.key} tone={c.key === 'overdue' || c.key === 'unassigned' ? 'red' : 'amber'} className="px-2 py-1">
                  {c.label}: {c.count} <span className="opacity-70">(−{c.penalty})</span>
                </Badge>
              ))}
              {active.length === 0 && <Badge tone="green" className="px-2 py-1">No risk signals</Badge>}
            </div>
          </div>
        </div>
        <details className="group border-t">
          <summary className="flex cursor-pointer list-none items-center gap-1 px-5 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground">
            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" /> How is the score calculated?
          </summary>
          <div className="px-5 pb-4">
            <p className="mb-2 text-xs text-muted-foreground">Starts at 100. Each risk signal subtracts a fixed amount per task, capped so one problem can’t dominate. Deterministic — AI never changes it.</p>
            <div className="overflow-hidden rounded-md border text-xs">
              <div className="grid grid-cols-[1fr_70px_70px_80px] gap-2 bg-muted/50 px-3 py-1.5 font-medium text-muted-foreground">
                <span>Signal</span><span className="text-right">Tasks</span><span className="text-right">Per task</span><span className="text-right">Penalty</span>
              </div>
              {report.components.map((c) => (
                <div key={c.key} className="grid grid-cols-[1fr_70px_70px_80px] gap-2 border-t px-3 py-1.5">
                  <span><span className="font-medium">{c.label}</span> <span className="text-muted-foreground">— {c.why}</span></span>
                  <span className="text-right tabular-nums">{c.count}</span>
                  <span className="text-right tabular-nums text-muted-foreground">−{c.count ? Math.round(c.penalty / c.count) : 0}</span>
                  <span className={cn('text-right tabular-nums', c.penalty ? 'font-medium text-red-600 dark:text-red-400' : 'text-muted-foreground')}>−{c.penalty} <span className="font-normal text-muted-foreground">/ {c.cap}</span></span>
                </div>
              ))}
              <div className="grid grid-cols-[1fr_80px] border-t bg-muted/30 px-3 py-1.5 font-medium"><span>Score</span><span className="text-right">{report.score}</span></div>
            </div>
          </div>
        </details>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Recommended actions */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Recommended actions</CardTitle>
                <p className="text-xs text-muted-foreground">Highest risk first · each fix updates the score immediately</p>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {report.riskTasks.length === 0 ? (
                <div className="flex items-center gap-3 px-4 py-8 text-sm"><CheckCircle2 className="size-5 text-emerald-500" /> Nothing to fix — no task is overdue, blocked or ownerless.</div>
              ) : (
                <ol className="divide-y">
                  {report.riskTasks.map((t, i) => {
                    const actions = actionsFor(t);
                    return (
                      <li key={t.id} className="px-4 py-3.5">
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground">{i + 1}</span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Link href={`/tasks/${t.id}`} className="text-sm font-medium hover:underline">{t.title}</Link>
                              <PriorityBadge priority={t.priority} />
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              {t.signals.map((s) => <Badge key={s} tone={SIGNAL_TONE[s]}>{SIGNAL_LABEL[s]}</Badge>)}
                            </div>
                            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                              <span className="inline-flex items-center gap-1">
                                <Avatar name={t.assignee_name ?? '?'} className={cn('size-4 text-[8px]', !t.assignee_name && 'opacity-40')} />
                                {t.assignee_name ?? 'No owner'}
                              </span>
                              <StatusPill task={toAction(t)} editable={canEdit(t)} />
                              <span>· {why(t)}</span>
                            </p>
                            {actions.length > 0 && !isViewer && <div className="mt-2.5 flex flex-wrap gap-1.5">{actions}</div>}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        {/* AI + timeline */}
        <div className="space-y-4">
          {can(ctx.role, 'continuity.analyze') && <AiAnalysis canCarry={canCarry} nextMeeting={next} titles={Object.fromEntries(report.riskTasks.map((t) => [t.id, t.title]))} />}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5"><HeartPulse className="size-4 text-muted-foreground" /> What happened (30 days)</CardTitle>
            </CardHeader>
            <CardContent><Timeline items={timeline} /></CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
