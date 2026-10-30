import 'server-only';
import type { AppContext } from '@/lib/auth';

export interface MemberRow {
  id: string;
  user_id: string;
  role: string;
  full_name: string;
  email: string;
}

export async function getMembers(ctx: AppContext): Promise<MemberRow[]> {
  const { data } = await ctx.supabase
    .from('workspace_members')
    .select('id,user_id,role,profile:profiles(full_name,email)')
    .eq('workspace_id', ctx.workspace.id)
    .order('created_at');
  return ((data ?? []) as unknown as { id: string; user_id: string; role: string; profile: { full_name: string; email: string } | null }[]).map((m) => ({
    id: m.id,
    user_id: m.user_id,
    role: m.role,
    full_name: m.profile?.full_name ?? 'Unknown',
    email: m.profile?.email ?? '',
  }));
}

export const TASK_SELECT =
  'id,title,description,status,priority,due_date,assignee_id,creator_id,source_meeting_id,outcome_notes,completed_at,created_at,updated_at,ai_generated,' +
  'assignee:profiles!action_items_assignee_id_fkey(id,full_name),meeting:meetings!action_items_source_meeting_id_fkey(id,title)';

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  assignee_id: string | null;
  creator_id: string | null;
  source_meeting_id: string | null;
  outcome_notes: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  ai_generated: boolean;
  assignee: { id: string; full_name: string } | null;
  meeting: { id: string; title: string } | null;
}

export function activityText(a: { action: string; metadata: Record<string, unknown> | null }): string {
  const m = (a.metadata ?? {}) as Record<string, string | number | undefined>;
  switch (a.action) {
    case 'meeting.created': return `scheduled "${m.title}"`;
    case 'meeting.updated': return `updated meeting "${m.title}"`;
    case 'meeting.completed': return `completed meeting "${m.title}"`;
    case 'meeting.ai_applied': return `approved AI results for "${m.title}" (${m.decisions} decisions, ${m.tasks} tasks)`;
    case 'task.created': return `created task "${m.title}"`;
    case 'task.updated': return `updated "${m.title}"`;
    case 'task.status_changed': return `moved "${m.title}" to ${String(m.to ?? '').replace('_', ' ')}`;
    case 'task.reassigned': return `reassigned "${m.title}"`;
    case 'task.closed': return `closed "${m.title}"`;
    case 'task.carried_forward': return m.count ? `carried ${m.count} task(s) into "${m.meeting}"` : `carried "${m.title}" into "${m.meeting}"`;
    case 'handover.completed': return `completed a handover ${m.from} → ${m.to} (${m.tasks} task${m.tasks === 1 ? '' : 's'})`;
    case 'document.uploaded': return `uploaded "${m.title}"`;
    case 'document.deleted': return `deleted document "${m.title}"`;
    case 'document.linked': return `linked "${m.document}"`;
    case 'brief.generated': return `generated a catch-up brief for "${m.title}"`;
    case 'member.role_changed': return `changed a member's role ${m.from} → ${m.to}`;
    default: return a.action;
  }
}

export function activityHref(a: { target_type: string; target_id: string | null }): string | null {
  if (!a.target_id) return null;
  const map: Record<string, string> = { meeting: '/meetings/', action_item: '/tasks/', handover: '/handovers/', document: '/knowledge/' };
  return map[a.target_type] ? map[a.target_type] + a.target_id : null;
}
