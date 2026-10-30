import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRightLeft, FileText, Gavel, Sparkles } from 'lucide-react';
import { requireContext } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { getMembers, TASK_SELECT, type TaskRow } from '@/lib/queries';
import { PageHeader } from '@/components/shell';
import { Avatar, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Empty } from '@/components/ui';
import { MeetingStatusBadge, OverdueBadge, PriorityBadge, StatusBadge } from '@/components/badges';
import { fmtDate, fmtDateTime } from '@/lib/utils';
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

  return (
    <div className="animate-in">
      <PageHeader
        title={meeting.title}
        description={`${fmtDateTime(meeting.scheduled_at)} · created by ${(meeting.creator as { full_name: string } | null)?.full_name ?? 'unknown'}`}
        actions={
          <>
            <MeetingStatusBadge status={meeting.status} />
            {isEditor && <MeetingStatusControl meetingId={id} status={meeting.status} />}
          </>
        }
      />

      {meeting.status === 'completed' && me && !me.attended && (
        <Card className="mb-4 flex items-center justify-between border-indigo-500/30 bg-indigo-500/5 p-3 text-sm">
          <span className="flex items-center gap-2"><Sparkles className="size-4 text-indigo-500" /> You missed this meeting.</span>
          <Link href={`/briefs?meeting=${id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">Generate my catch-up brief →</Link>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {meeting.agenda && (
            <Card>
              <CardHeader><CardTitle>Agenda</CardTitle></CardHeader>
              <CardContent><p className="whitespace-pre-wrap text-sm text-muted-foreground">{meeting.agenda}</p></CardContent>
            </Card>
          )}

          {meeting.summary && (
            <Card>
              <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
              <CardContent><p className="text-sm leading-relaxed">{meeting.summary}</p></CardContent>
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
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5"><Gavel className="size-4 text-muted-foreground" /> Decisions</CardTitle>
            </CardHeader>
            <CardContent>
              {(decisions ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No decisions recorded yet.</p>
              ) : (
                <ul className="space-y-2.5">
                  {(decisions ?? []).map((d) => (
                    <li key={d.id} className="rounded-md border p-2.5">
                      <p className="flex items-center gap-2 text-sm font-medium">{d.title} {d.ai_generated && <Badge tone="indigo">AI · approved</Badge>}</p>
                      {d.description && <p className="mt-0.5 text-xs text-muted-foreground">{d.description}</p>}
                      {d.rationale && <p className="mt-1 text-xs"><span className="text-muted-foreground">Why: </span>{d.rationale}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Action items</CardTitle>
                <CardDescription>Created in this meeting or carried forward into it.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {tasks.length === 0 ? (
                <Empty title="No action items yet">Run AI extraction on the notes, or carry forward unresolved tasks.</Empty>
              ) : (
                <ul className="divide-y">
                  {tasks.map(({ task, is_carried_forward }) => (
                    <li key={task!.id} className="flex flex-wrap items-center gap-2 py-2">
                      <Link href={`/tasks/${task!.id}`} className="min-w-0 flex-1 truncate text-sm hover:underline">{task!.title}</Link>
                      {is_carried_forward && <Badge tone="amber"><ArrowRightLeft className="size-3" /> carried from {task!.meeting?.title ? `"${task!.meeting.title}"` : 'earlier'}</Badge>}
                      <OverdueBadge due={task!.due_date} status={task!.status} />
                      <PriorityBadge priority={task!.priority} />
                      <StatusBadge status={task!.status} />
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Avatar name={task!.assignee?.full_name ?? 'Unassigned'} className="size-5 text-[9px]" />
                        {task!.assignee?.full_name ?? 'Unassigned'} · {fmtDate(task!.due_date)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <AttendanceEditor meetingId={id} participants={parts} members={members.map((m) => ({ id: m.user_id, name: m.full_name }))} canEdit={isEditor} completed={meeting.status === 'completed'} />

          {can(ctx.role, 'meeting.carry_forward') && meeting.status !== 'completed' && meeting.status !== 'cancelled' && (
            <CarryForwardPanel meetingId={id} candidates={carryCandidates} />
          )}

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-1.5"><FileText className="size-4 text-muted-foreground" /> Linked documents</CardTitle></CardHeader>
            <CardContent>
              {docs.length === 0 ? (
                <p className="text-xs text-muted-foreground">No documents linked. Use “Suggest links” on a document in the Knowledge Base.</p>
              ) : (
                <ul className="space-y-1.5">
                  {docs.map((d) => (
                    <li key={d.document!.id} className="text-sm">
                      <Link href={`/knowledge/${d.document!.id}`} className="hover:underline">{d.document!.title}</Link>
                      {d.reason && <p className="text-xs text-muted-foreground">{d.reason}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
