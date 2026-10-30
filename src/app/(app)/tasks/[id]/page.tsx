import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireContext } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { getMembers, TASK_SELECT, type TaskRow } from '@/lib/queries';
import { Avatar, Card } from '@/components/ui';
import { Timeline, type TimelineItem } from '@/components/timeline';
import { STATUS_LABEL } from '@/components/badges';
import { cn, fmtDate, isOverdue } from '@/lib/utils';
import { AlignLeft, ArrowRight, ArrowRightLeft, CalendarClock, CalendarDays, CheckCircle2, FileText, Flag, Hash, History, Repeat2, Sparkles } from 'lucide-react';
import { Meta, SectionHeader } from '@/components/meta';
import { CompleteButton, NextStepButton, StatusPill, TaskRowMenu, type ActionTask } from '@/components/task-actions';
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

  const late = isOverdue(task.due_date, task.status);
  const action: ActionTask = { id: task.id, title: task.title, status: task.status, priority: task.priority, due_date: task.due_date, assignee_id: task.assignee_id };
  const dueRel = task.due_date ? Math.round((new Date(task.due_date).getTime() - Date.now()) / 86_400_000) : null;

  return (
    <div className="animate-in space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className={cn('text-xl font-semibold tracking-tight', task.status === 'done' && 'text-muted-foreground line-through decoration-muted-foreground/40')}>{task.title}</h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
            <StatusPill task={action} editable={canManage} />
            <span className="flex items-center gap-1.5 text-sm">
              <Avatar name={task.assignee?.full_name ?? '?'} className={cn('size-5 text-[9px]', !task.assignee && 'opacity-30')} />
              {task.assignee?.full_name ?? <span className="text-muted-foreground">No owner</span>}
            </span>
            <Meta icon={CalendarClock} className={late ? 'font-medium text-red-600 dark:text-red-400' : ''}>
              {task.due_date ? `${fmtDate(task.due_date).replace(/ \d{4}$/, '')}${task.status !== 'done' && dueRel !== null ? ` · ${late ? `${Math.max(1, -dueRel)}d late` : dueRel === 0 ? 'today' : `in ${dueRel}d`}` : ''}` : 'No deadline'}
            </Meta>
            <Meta icon={Flag} className={task.priority === 'urgent' ? 'text-red-600 dark:text-red-400' : task.priority === 'high' ? 'text-amber-600 dark:text-amber-400' : ''}>
              <span className="capitalize">{task.priority}</span>
            </Meta>
            {task.meeting && <Link href={`/meetings/${task.meeting.id}`} className="hover:text-foreground"><Meta icon={CalendarDays}>{task.meeting.title}</Meta></Link>}
            {task.ai_generated && <Meta icon={Sparkles} className="text-indigo-600 dark:text-indigo-400" title="Extracted by AI, approved by a lead">AI-extracted</Meta>}
            <Meta icon={Hash} title={task.id}>{task.id.slice(0, 8)}</Meta>
          </div>
        </div>
        {canManage && task.status !== 'done' && (
          <div className="flex items-center gap-1.5">
            <NextStepButton task={action} editable={canManage} />
            {!(task.status === 'in_progress' && !late) && <CompleteButton task={action} variant="default" />}
            <TaskRowMenu task={action} canEdit={canManage} />
          </div>
        )}
      </div>

      {task.outcome_notes && (
        <div className="flex gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
          <div>
            <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">Completed {fmtDate(task.completed_at)} · Outcome</p>
            <p className="mt-0.5 text-sm">{task.outcome_notes}</p>
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {task.description && (
            <Card>
              <SectionHeader icon={AlignLeft} title="Details" />
              <p className="whitespace-pre-wrap px-5 py-4 text-sm leading-relaxed text-muted-foreground">{task.description}</p>
            </Card>
          )}
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
            <SectionHeader icon={History} title="History" count={items.length} />
            <div className="px-5 py-4"><Timeline items={items} /></div>
          </Card>
        </div>
        <div className="space-y-5">
          <TaskActions
            task={{ id: task.id, status: task.status, priority: task.priority, due_date: task.due_date, assignee_id: task.assignee_id }}
            members={members.filter((m) => m.role !== 'viewer').map((m) => ({ id: m.user_id, name: m.full_name }))}
            canManage={canManage}
            canReassign={isLead || task.assignee_id === ctx.user.id}
          />
          <Card>
            <SectionHeader icon={CalendarDays} title="Meetings" count={meetingLinks.length} />
            {meetingLinks.length === 0 ? <p className="px-5 py-4 text-xs text-muted-foreground">Not linked to a meeting.</p> : (
              <ul className="divide-y">
                {meetingLinks.map((l) => (
                  <li key={l.meeting!.id}>
                    <Link href={`/meetings/${l.meeting!.id}`} className="flex items-center gap-2.5 px-5 py-2.5 text-sm hover:bg-accent/50">
                      {l.is_carried_forward ? <ArrowRightLeft className="size-4 shrink-0 text-amber-500" /> : <CalendarDays className="size-4 shrink-0 text-indigo-500" />}
                      <span className="min-w-0 flex-1 truncate">{l.meeting!.title}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{l.is_carried_forward ? 'carried in' : 'origin'}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {hos.length > 0 && (
            <Card>
              <SectionHeader icon={Repeat2} title="Handovers" count={hos.length} />
              <ul className="divide-y">
                {hos.map((h) => (
                  <li key={h.handover!.id}>
                    <Link href={`/handovers/${h.handover!.id}`} className="flex items-center gap-2 px-5 py-2.5 text-sm hover:bg-accent/50">
                      <Avatar name={h.handover!.outgoing?.full_name} className="size-5 text-[9px]" />
                      <ArrowRight className="size-3.5 text-muted-foreground" />
                      <Avatar name={h.handover!.incoming?.full_name} className="size-5 text-[9px]" />
                      <span className="min-w-0 flex-1 truncate">{h.handover!.incoming?.full_name}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{fmtDate(h.handover!.completed_at).replace(/ \d{4}$/, '')}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <SectionHeader icon={FileText} title="Documents" count={docs.length} />
            {docs.length === 0 ? <p className="px-5 py-4 text-xs text-muted-foreground">None linked yet.</p> : (
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
