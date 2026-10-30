import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRightLeft, CalendarDays, CheckSquare, Clock, FileText, Gavel, ListOrdered, Sparkles, UserRound, Users } from 'lucide-react';
import { requireContext } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { getMembers, TASK_SELECT, type TaskRow } from '@/lib/queries';
import { Avatar, Badge, Card, buttonVariants } from '@/components/ui';
import { MeetingStatusBadge } from '@/components/badges';
import { Meta, SectionHeader } from '@/components/meta';
import { StatusIcon } from '@/components/task-icons';
import { cn, fmtDate, isOverdue } from '@/lib/utils';
import { AttendanceEditor, AiExtractPanel, CarryForwardPanel, MeetingStatusControl, NotesEditor } from './meeting-client';

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const { data: meeting } = await ctx.supabase.from('meetings').select('*, creator:profiles!meetings_created_by_fkey(full_name)').eq('id', id).eq('workspace_id', ctx.workspace.id).maybeSingle();
  if (!meeting) notFound();

  const [{ data: participants }, { data: decisions }, { data: links }, members, { data: openTasks }] = await Promise.all([
    ctx.supabase.from('meeting_participants').select('user_id,attended,profile:profiles(full_name)').eq('meeting_id', id),
    ctx.supabase.from('decisions').select('id,title,description,rationale,ai_generated,created_at').eq('meeting_id', id).order('created_at'),
    ctx.supabase.from('meeting_action_items').select(`is_carried_forward,notes,task:action_items(${TASK_SELECT})`).eq('meeting_id', id),
    getMembers(ctx),
    ctx.supabase.from('action_items').select('id,title,status,due_date,source_meeting_id').eq('workspace_id', ctx.workspace.id).neq('status', 'done').order('due_date'),
  ]);

  const parts = ((participants ?? []) as unknown as { user_id: string; attended: boolean; profile: { full_name: string } | null }[]).map((p) => ({ user_id: p.user_id, attended: p.attended, name: p.profile?.full_name ?? 'Unknown' }));
  const tasks = ((links ?? []) as unknown as { is_carried_forward: boolean; notes: string | null; task: TaskRow | null }[]).filter((l) => l.task);
  const linkedIds = new Set(tasks.map((t) => t.task!.id));
  const decisionIds = (decisions ?? []).map((d) => d.id);
  const { data: docLinks } = await ctx.supabase
    .from('knowledge_links')
    .select('target_id,reason,document:knowledge_documents(id,title,file_name)')
    .in('target_id', [id, ...decisionIds, ...Array.from(linkedIds)]);
  const docs = Array.from(new Map(((docLinks ?? []) as unknown as { reason: string | null; document: { id: string; title: string } | null }[]).filter((d) => d.document).map((d) => [d.document!.id, d])).values());

  const me = parts.find((p) => p.user_id === ctx.user.id);
  const canNotes = can(ctx.role, 'meeting.notes');
  const isEditor = can(ctx.role, 'meeting.edit');
  const carryCandidates = (openTasks ?? []).filter((t) => !linkedIds.has(t.id));

  const TZ = 'Asia/Kolkata';
  const when = new Date(meeting.scheduled_at);
  const agendaItems = (meeting.agenda ?? '').split(/\n+/).map((l: string) => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, '').trim()).filter(Boolean);
  const attended = parts.filter((p) => p.attended).length;
  const creator = (meeting.creator as unknown as { full_name: string } | null)?.full_name ?? 'unknown';

  return (
    <div className="animate-in space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center gap-2"><MeetingStatusBadge status={meeting.status} /></div>
          <h1 className="text-xl font-semibold tracking-tight">{meeting.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <Meta icon={CalendarDays}>{when.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ })}</Meta>
            <Meta icon={Clock}>{when.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: TZ })}</Meta>
            <Meta icon={Users}>{meeting.status === 'completed' ? `${attended}/${parts.length} attended` : `${parts.length} invited`}</Meta>
            <Meta icon={CheckSquare}>{tasks.length} task{tasks.length === 1 ? '' : 's'}</Meta>
            <Meta icon={UserRound}>by {creator}</Meta>
          </div>
        </div>
        {isEditor && <MeetingStatusControl meetingId={id} status={meeting.status} />}
      </div>

      {meeting.status === 'completed' && me && !me.attended && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-indigo-500/25 bg-indigo-500/[0.06] px-4 py-3">
          <Sparkles className="size-4 text-indigo-500" />
          <p className="flex-1 text-sm">You missed this meeting.</p>
          <Link href={`/briefs?meeting=${id}`} className={buttonVariants({ size: 'sm', variant: 'secondary' })}>Catch me up</Link>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {(agendaItems.length > 0 || meeting.summary) && (
            <Card>
              {meeting.summary && (
                <div className="border-b px-5 py-4">
                  <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><Sparkles className="size-3.5 text-indigo-500" /> Summary</p>
                  <p className="text-sm leading-relaxed">{meeting.summary}</p>
                </div>
              )}
              {agendaItems.length > 0 && (
                <div className="px-5 py-4">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><ListOrdered className="size-3.5" /> Agenda</p>
                  <ol className="space-y-1.5">
                    {agendaItems.map((a: string, i: number) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm">
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">{i + 1}</span>
                        <span className="pt-px">{a}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </Card>
          )}

          <NotesEditor meetingId={id} initial={meeting.raw_notes ?? ''} canEdit={canNotes} />

          {canNotes && (
            <AiExtractPanel
              meetingId={id}
              hasNotes={(meeting.raw_notes ?? '').trim().length >= 20}
              canApply={can(ctx.role, 'meeting.ai_apply')}
              members={members.filter((m) => m.role !== 'viewer').map((m) => ({ id: m.user_id, name: m.full_name }))}
            />
          )}

          <Card>
            <SectionHeader icon={Gavel} title="Decisions" count={(decisions ?? []).length} />
            {(decisions ?? []).length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">No decisions yet — use AI extraction on the notes.</p>
            ) : (
              <ul className="divide-y">
                {(decisions ?? []).map((d) => (
                  <li key={d.id} className="flex gap-3 px-5 py-3">
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-indigo-500" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{d.title}</p>
                      {d.rationale && <p className="mt-0.5 text-xs text-muted-foreground">Why: {d.rationale}</p>}
                    </div>
                    {d.ai_generated && <Badge tone="indigo" className="h-fit shrink-0"><Sparkles className="size-3" /> AI</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <SectionHeader icon={CheckSquare} title="Tasks" count={tasks.length} />
            {tasks.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">No tasks yet — extract them from the notes or carry unresolved ones forward.</p>
            ) : (
              <ul className="divide-y">
                {tasks.map(({ task, is_carried_forward }) => {
                  const t = task!;
                  const late = isOverdue(t.due_date, t.status);
                  return (
                    <li key={t.id} className="flex items-center gap-3 px-5 py-2.5">
                      <StatusIcon status={t.status} />
                      <div className="min-w-0 flex-1">
                        <Link href={`/tasks/${t.id}`} className={cn('block truncate text-sm font-medium hover:underline', t.status === 'done' && 'text-muted-foreground line-through')}>{t.title}</Link>
                        {is_carried_forward && <Meta icon={ArrowRightLeft} className="text-amber-600 dark:text-amber-400">carried from {t.meeting?.title ?? 'an earlier meeting'}</Meta>}
                      </div>
                      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <Avatar name={t.assignee?.full_name ?? '?'} className={cn('size-5 text-[9px]', !t.assignee && 'opacity-30')} />
                        <span className="hidden sm:inline">{t.assignee?.full_name.split(' ')[0] ?? 'No owner'}</span>
                      </span>
                      <span className={cn('w-16 shrink-0 text-right text-xs tabular-nums', late ? 'font-medium text-red-600 dark:text-red-400' : 'text-muted-foreground')}>{t.due_date ? fmtDate(t.due_date).replace(/ \d{4}$/, '') : '—'}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <AttendanceEditor meetingId={id} participants={parts} members={members.map((m) => ({ id: m.user_id, name: m.full_name }))} canEdit={isEditor} completed={meeting.status === 'completed'} />

          {can(ctx.role, 'meeting.carry_forward') && meeting.status !== 'completed' && meeting.status !== 'cancelled' && (
            <CarryForwardPanel meetingId={id} candidates={carryCandidates} />
          )}

          <Card>
            <SectionHeader icon={FileText} title="Documents" count={docs.length} />
            {docs.length === 0 ? (
              <p className="px-5 py-4 text-xs text-muted-foreground">None linked yet.</p>
            ) : (
              <ul className="divide-y">
                {docs.map((d) => (
                  <li key={d.document!.id}>
                    <Link href={`/knowledge/${d.document!.id}`} className="flex items-center gap-2.5 px-5 py-2.5 text-sm hover:bg-accent/50">
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{d.document!.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
