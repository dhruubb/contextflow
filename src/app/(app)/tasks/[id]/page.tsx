import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireContext } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { getMembers, TASK_SELECT, type TaskRow } from '@/lib/queries';
import { PageHeader } from '@/components/shell';
import { Avatar, Badge, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { OverdueBadge, PriorityBadge, STATUS_LABEL, StatusBadge } from '@/components/badges';
import { Timeline, type TimelineItem } from '@/components/timeline';
import { fmtDate } from '@/lib/utils';
import { TaskActions } from '../task-client';
import { TaskBriefCard } from './task-brief';
import type { TaskBrief } from '@/lib/ai/prompts';

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const { data } = await ctx.supabase.from('action_items').select(TASK_SELECT).eq('id', id).eq('workspace_id', ctx.workspace.id).maybeSingle();
  if (!data) notFound();
  const task = data as unknown as TaskRow;

  const [{ data: events }, { data: links }, { data: handovers }, { data: docLinks }, members, { data: decisions }, { data: srcMeeting }, { data: lastBrief }] = await Promise.all([
    ctx.supabase.from('task_events').select('event_type,previous_value,new_value,notes,created_at,actor:profiles(full_name)').eq('task_id', id).order('created_at'),
    ctx.supabase.from('meeting_action_items').select('is_carried_forward,created_at,meeting:meetings(id,title,scheduled_at,status)').eq('action_item_id', id),
    ctx.supabase.from('handover_items').select('created_at,handover:handovers(id,completed_at,ai_summary,outgoing:profiles!handovers_outgoing_user_id_fkey(full_name),incoming:profiles!handovers_incoming_user_id_fkey(full_name))').eq('action_item_id', id),
    ctx.supabase.from('knowledge_links').select('created_at,reason,document:knowledge_documents(id,title)').eq('target_type', 'action_item').eq('target_id', id),
    getMembers(ctx),
    task.source_meeting_id ? ctx.supabase.from('decisions').select('id,title,rationale,created_at').eq('meeting_id', task.source_meeting_id) : Promise.resolve({ data: [] as { id: string; title: string; rationale: string | null; created_at: string }[] }),
    task.source_meeting_id ? ctx.supabase.from('meetings').select('id,title,scheduled_at').eq('id', task.source_meeting_id).maybeSingle() : Promise.resolve({ data: null }),
    ctx.supabase.from('ai_generations').select('parsed_output,created_at').eq('target_type', 'action_item').eq('target_id', id).eq('status', 'success').not('parsed_output', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const briefData = lastBrief?.parsed_output && (lastBrief.parsed_output as TaskBrief).where_it_stands ? { brief: lastBrief.parsed_output as TaskBrief, generatedAt: lastBrief.created_at as string } : null;

  const name = (uid: string | null) => (uid ? members.find((m) => m.user_id === uid)?.full_name ?? 'former member' : 'Unassigned');
  const items: TimelineItem[] = [];
  if (srcMeeting) items.push({ at: srcMeeting.scheduled_at, kind: 'meeting', title: `Originated in "${srcMeeting.title}"`, href: `/meetings/${srcMeeting.id}` });
  for (const d of decisions ?? []) items.push({ at: d.created_at, kind: 'decision', title: `Decision: ${d.title}`, detail: d.rationale });

  type Ev = { event_type: string; previous_value: string | null; new_value: string | null; notes: string | null; created_at: string; actor: { full_name: string } | null };
  for (const e of (events ?? []) as unknown as Ev[]) {
    const actor = e.actor?.full_name;
    switch (e.event_type) {
      case 'created': items.push({ at: e.created_at, kind: 'created', title: 'Task created', actor, detail: e.notes }); break;
      case 'status_changed': items.push({ at: e.created_at, kind: 'status', title: `${STATUS_LABEL[e.previous_value ?? ''] ?? e.previous_value} → ${STATUS_LABEL[e.new_value ?? ''] ?? e.new_value}`, actor, detail: e.notes }); break;
      case 'reassigned': items.push({ at: e.created_at, kind: 'reassigned', title: `Reassigned ${name(e.previous_value)} → ${name(e.new_value)}`, actor, detail: e.notes }); break;
      case 'handed_over': items.push({ at: e.created_at, kind: 'handover', title: `Handed over ${name(e.previous_value)} → ${name(e.new_value)}`, actor, detail: e.notes?.startsWith('Handover ') ? null : e.notes }); break;
      case 'carried_forward': items.push({ at: e.created_at, kind: 'carried', title: 'Carried forward', actor, detail: e.notes, href: e.new_value ? `/meetings/${e.new_value}` : undefined }); break;
      case 'closed': items.push({ at: e.created_at, kind: 'closed', title: 'Closed', actor, detail: e.notes ? `Outcome: ${e.notes}` : null }); break;
      case 'priority_changed': items.push({ at: e.created_at, kind: 'updated', title: `Priority ${e.previous_value} → ${e.new_value}`, actor, detail: e.notes }); break;
      case 'due_date_changed': items.push({ at: e.created_at, kind: 'updated', title: `Deadline ${e.previous_value} → ${e.new_value}`, actor, detail: e.notes }); break;
      case 'document_linked': items.push({ at: e.created_at, kind: 'document', title: e.notes ?? 'Document linked', actor, href: e.new_value ? `/knowledge/${e.new_value}` : undefined }); break;
      case 'comment_added': items.push({ at: e.created_at, kind: 'comment', title: 'Comment', actor, detail: e.notes }); break;
      default: items.push({ at: e.created_at, kind: 'updated', title: e.notes ?? e.event_type, actor });
    }
  }
  items.sort((a, b) => a.at.localeCompare(b.at));

  const meetingLinks = ((links ?? []) as unknown as { is_carried_forward: boolean; meeting: { id: string; title: string; scheduled_at: string; status: string } | null }[]).filter((l) => l.meeting);
  const hos = ((handovers ?? []) as unknown as { handover: { id: string; completed_at: string | null; outgoing: { full_name: string } | null; incoming: { full_name: string } | null } | null }[]).filter((h) => h.handover);
  const docs = ((docLinks ?? []) as unknown as { reason: string | null; document: { id: string; title: string } | null }[]).filter((d) => d.document);

  const isLead = can(ctx.role, 'task.manage_any');
  const isOwner = task.assignee_id === ctx.user.id || task.creator_id === ctx.user.id;
  const canManage = isLead || (can(ctx.role, 'task.update_own') && isOwner);

  return (
    <div className="animate-in">
      <PageHeader
        title={task.title}
        description={task.meeting ? `From “${task.meeting.title}”` : 'Standalone task'}
        actions={
          <>
            {task.ai_generated && <Badge tone="indigo">AI-extracted · human-approved</Badge>}
            <OverdueBadge due={task.due_date} status={task.status} />
            <PriorityBadge priority={task.priority} />
            <StatusBadge status={task.status} />
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardContent className="grid gap-4 p-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Owner</p>
                <p className="mt-1 flex items-center gap-1.5 text-sm font-medium"><Avatar name={task.assignee?.full_name ?? '?'} className="size-5 text-[9px]" />{task.assignee?.full_name ?? 'Unassigned'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Deadline</p>
                <p className="mt-1 text-sm font-medium">{fmtDate(task.due_date)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Task ID</p>
                <p className="mt-1 truncate font-mono text-xs">{task.id}</p>
              </div>
              {task.description && <p className="whitespace-pre-wrap text-sm text-muted-foreground sm:col-span-3">{task.description}</p>}
              {task.outcome_notes && (
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 sm:col-span-3">
                  <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Outcome · closed {fmtDate(task.completed_at)}</p>
                  <p className="mt-1 text-sm">{task.outcome_notes}</p>
                </div>
              )}
            </CardContent>
          </Card>
          <TaskBriefCard
            taskId={task.id}
            taskTitle={task.title}
            initial={briefData}
            canGenerate={can(ctx.role, 'brief.generate')}
            canAdd={can(ctx.role, 'task.create')}
            selfId={ctx.user.id}
            meetingId={task.source_meeting_id}
          />
          <Card>
            <CardHeader><CardTitle>Complete history</CardTitle></CardHeader>
            <CardContent><Timeline items={items} /></CardContent>
          </Card>
        </div>
        <div className="space-y-4">
          <TaskActions
            task={{ id: task.id, status: task.status, priority: task.priority, due_date: task.due_date, assignee_id: task.assignee_id }}
            members={members.filter((m) => m.role !== 'viewer').map((m) => ({ id: m.user_id, name: m.full_name }))}
            canManage={canManage}
            canReassign={isLead || task.assignee_id === ctx.user.id}
          />
          <Card>
            <CardHeader><CardTitle>Meetings</CardTitle></CardHeader>
            <CardContent className="space-y-1.5">
              {meetingLinks.length === 0 && <p className="text-xs text-muted-foreground">Not linked to any meeting.</p>}
              {meetingLinks.map((l) => (
                <Link key={l.meeting!.id} href={`/meetings/${l.meeting!.id}`} className="flex items-center justify-between gap-2 rounded p-1 text-sm hover:bg-accent">
                  <span className="truncate">{l.meeting!.title}</span>
                  <Badge tone={l.is_carried_forward ? 'amber' : 'neutral'}>{l.is_carried_forward ? 'carried' : 'origin'}</Badge>
                </Link>
              ))}
            </CardContent>
          </Card>
          {hos.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Handovers</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {hos.map((h) => (
                  <Link key={h.handover!.id} href={`/handovers/${h.handover!.id}`} className="block rounded p-1 text-sm hover:bg-accent">
                    {h.handover!.outgoing?.full_name} → {h.handover!.incoming?.full_name}
                    <span className="block text-xs text-muted-foreground">{fmtDate(h.handover!.completed_at)} · view AI brief</span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader><CardTitle>Linked documents</CardTitle></CardHeader>
            <CardContent className="space-y-1.5">
              {docs.length === 0 && <p className="text-xs text-muted-foreground">None yet.</p>}
              {docs.map((d) => (
                <div key={d.document!.id} className="text-sm">
                  <Link href={`/knowledge/${d.document!.id}`} className="hover:underline">{d.document!.title}</Link>
                  {d.reason && <p className="text-xs text-muted-foreground">{d.reason}</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
