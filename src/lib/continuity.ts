import 'server-only';
import { cache } from 'react';
import type { SupabaseServer } from '@/lib/supabase/server';

/**
 * Context Continuity Engine — deterministic, explainable part.
 * Score starts at 100; each risk signal subtracts a fixed penalty per task, capped per signal.
 * The AI layer (lib/ai) only explains these results and recommends actions; it never changes the score.
 */
export const SIGNALS = [
  { key: 'overdue', label: 'Overdue tasks', per: 8, cap: 32, why: 'Past their deadline and not done.' },
  { key: 'blocked', label: 'Blocked tasks', per: 6, cap: 18, why: 'Marked blocked — need someone to unblock them.' },
  { key: 'unassigned', label: 'Unassigned open tasks', per: 6, cap: 18, why: 'Nobody owns them, so they silently stall.' },
  { key: 'carried', label: 'Repeatedly carried forward', per: 4, cap: 12, why: 'Carried into 2+ meetings without resolution.' },
  { key: 'dueSoon', label: 'Due within 48h, not started', per: 3, cap: 9, why: 'Deadline is close and work has not started.' },
  { key: 'missedOwner', label: 'Owner missed the source meeting', per: 3, cap: 9, why: 'Owner was absent when the task was agreed — context gap.' },
] as const;
export type SignalKey = (typeof SIGNALS)[number]['key'];

export const SIGNAL_LABEL: Record<SignalKey, string> = {
  overdue: 'Overdue',
  blocked: 'Blocked',
  unassigned: 'No owner',
  carried: 'Carried 2+ times',
  dueSoon: 'Due in <48h, not started',
  missedOwner: 'Owner missed the meeting',
};

export interface RiskTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  assignee_id: string | null;
  creator_id: string | null;
  assignee_name: string | null;
  source_meeting_id: string | null;
  source_meeting_title: string | null;
  carry_count: number;
  signals: SignalKey[];
  /** latest reason given when the task was marked blocked */
  blocked_reason?: string | null;
}

export interface HealthReport {
  score: number;
  status: 'healthy' | 'moderate' | 'critical';
  components: { key: SignalKey; label: string; why: string; count: number; penalty: number; cap: number }[];
  totals: { open: number; done: number; overdue: number; blocked: number; unassigned: number };
  riskTasks: RiskTask[];
  nextMeeting: { id: string; title: string; scheduled_at: string } | null;
  agendaSuggestions: { task: RiskTask; reason: string }[];
}

export const computeHealth = cache(async (supabase: SupabaseServer, workspaceId: string): Promise<HealthReport> => {
  const now = Date.now();
  const [{ data: tasks }, { data: links }, { data: nextMeetings }, { data: participants }] = await Promise.all([
    supabase
      .from('action_items')
      .select('id,title,status,priority,due_date,assignee_id,creator_id,source_meeting_id,assignee:profiles!action_items_assignee_id_fkey(full_name),meeting:meetings!action_items_source_meeting_id_fkey(title)')
      .eq('workspace_id', workspaceId),
    supabase.from('meeting_action_items').select('action_item_id,meeting_id,is_carried_forward,meeting:meetings!inner(workspace_id)').eq('meeting.workspace_id', workspaceId).eq('is_carried_forward', true),
    supabase.from('meetings').select('id,title,scheduled_at').eq('workspace_id', workspaceId).eq('status', 'scheduled').gte('scheduled_at', new Date(now).toISOString()).order('scheduled_at').limit(1),
    supabase.from('meeting_participants').select('meeting_id,user_id,attended,meeting:meetings!inner(workspace_id,status)').eq('meeting.workspace_id', workspaceId).eq('meeting.status', 'completed'),
  ]);

  const carryCount = new Map<string, number>();
  for (const l of links ?? []) carryCount.set(l.action_item_id, (carryCount.get(l.action_item_id) ?? 0) + 1);
  const absent = new Set((participants ?? []).filter((p) => !p.attended).map((p) => `${p.meeting_id}:${p.user_id}`));
  const nextMeeting = nextMeetings?.[0] ?? null;
  const onNextAgenda = new Set<string>();
  if (nextMeeting) {
    const { data } = await supabase.from('meeting_action_items').select('action_item_id').eq('meeting_id', nextMeeting.id);
    (data ?? []).forEach((r) => onNextAgenda.add(r.action_item_id));
  }

  const all = (tasks ?? []) as unknown as {
    id: string; title: string; status: string; priority: string; due_date: string | null; assignee_id: string | null; creator_id: string | null;
    source_meeting_id: string | null; assignee: { full_name: string } | null; meeting: { title: string } | null;
  }[];
  const open = all.filter((t) => t.status !== 'done');
  const counts: Record<SignalKey, number> = { overdue: 0, blocked: 0, unassigned: 0, carried: 0, dueSoon: 0, missedOwner: 0 };

  const riskTasks: RiskTask[] = [];
  for (const t of open) {
    const signals: SignalKey[] = [];
    const due = t.due_date ? new Date(t.due_date).getTime() : null;
    if (due !== null && due < now) signals.push('overdue');
    if (t.status === 'blocked') signals.push('blocked');
    if (!t.assignee_id) signals.push('unassigned');
    if ((carryCount.get(t.id) ?? 0) >= 2) signals.push('carried');
    if (due !== null && due >= now && due - now <= 48 * 3600_000 && t.status === 'todo') signals.push('dueSoon');
    if (t.assignee_id && t.source_meeting_id && absent.has(`${t.source_meeting_id}:${t.assignee_id}`)) signals.push('missedOwner');
    signals.forEach((s) => counts[s]++);
    if (signals.length) {
      riskTasks.push({
        id: t.id, title: t.title, status: t.status, priority: t.priority, due_date: t.due_date,
        assignee_id: t.assignee_id, creator_id: t.creator_id, assignee_name: t.assignee?.full_name ?? null,
        source_meeting_id: t.source_meeting_id, source_meeting_title: t.meeting?.title ?? null,
        carry_count: carryCount.get(t.id) ?? 0, signals,
      });
    }
  }

  // What is each blocked task waiting on? (latest reason recorded in its history)
  const blockedIds = riskTasks.filter((r) => r.signals.includes('blocked')).map((r) => r.id);
  if (blockedIds.length) {
    const { data: reasons } = await supabase
      .from('task_events')
      .select('task_id,notes,created_at')
      .in('task_id', blockedIds)
      .eq('event_type', 'status_changed')
      .eq('new_value', 'blocked')
      .order('created_at', { ascending: false });
    for (const r of riskTasks) r.blocked_reason = reasons?.find((x) => x.task_id === r.id && x.notes)?.notes ?? null;
  }

  const components = SIGNALS.map((s) => ({
    key: s.key, label: s.label, why: s.why, count: counts[s.key], cap: s.cap,
    penalty: Math.min(s.cap, counts[s.key] * s.per),
  }));
  const score = Math.max(0, 100 - components.reduce((a, c) => a + c.penalty, 0));
  const weight = (r: RiskTask) => r.signals.length * 10 + ({ urgent: 4, high: 3, medium: 2, low: 1 }[r.priority] ?? 0);
  riskTasks.sort((a, b) => weight(b) - weight(a));

  const reasonText: Record<SignalKey, string> = {
    overdue: 'overdue', blocked: 'blocked', unassigned: 'has no owner', carried: 'carried forward repeatedly',
    dueSoon: 'due within 48h and not started', missedOwner: 'owner missed the meeting where it was agreed',
  };
  const agendaSuggestions = riskTasks
    .filter((r) => !onNextAgenda.has(r.id))
    .slice(0, 8)
    .map((task) => ({ task, reason: task.signals.map((s) => reasonText[s]).join(', ') }));

  return {
    score,
    status: score >= 80 ? 'healthy' : score >= 55 ? 'moderate' : 'critical',
    components,
    totals: {
      open: open.length,
      done: all.length - open.length,
      overdue: counts.overdue,
      blocked: counts.blocked,
      unassigned: counts.unassigned,
    },
    riskTasks,
    nextMeeting,
    agendaSuggestions,
  };
});
