import 'server-only';
import { cache } from 'react';
import type { AppContext } from '@/lib/auth';
import { computeHealth } from '@/lib/continuity';

export interface Trend {
  score: number;
  /** change since the previous recorded score (null when there is no history yet) */
  delta: number | null;
  since: string | null;
}

export interface NavBadges {
  tasks: { count: number; urgent: boolean };
  meetings: number;
  handovers: number;
  briefs: number;
  notifications: number;
  performance: Trend;
}

/**
 * Records a health snapshot whenever the score changes, and returns the trend vs the previous score.
 * Fails soft (no trend) if migration 004 has not been applied yet.
 */
const performanceTrend = cache(async (ctx: AppContext, score: number): Promise<Trend> => {
  const { data, error } = await ctx.supabase
    .from('health_snapshots')
    .select('score,created_at')
    .eq('workspace_id', ctx.workspace.id)
    .order('created_at', { ascending: false })
    .limit(2);
  if (error) return { score, delta: null, since: null };
  const [latest, previous] = data ?? [];
  if (!latest || latest.score !== score) {
    await ctx.supabase.from('health_snapshots').insert({ workspace_id: ctx.workspace.id, score });
    return latest ? { score, delta: score - latest.score, since: latest.created_at } : { score, delta: null, since: null };
  }
  return previous ? { score, delta: score - previous.score, since: previous.created_at } : { score, delta: null, since: null };
});

/** Small counts shown next to sidebar items. Cached per request. */
export const getNavBadges = cache(async (ctx: AppContext): Promise<NavBadges> => {
  const me = ctx.user.id;
  const ws = ctx.workspace.id;
  const now = new Date();
  const inAWeek = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  const threeDaysAgo = new Date(now.getTime() - 3 * 86_400_000).toISOString();

  const [health, unread, upcoming, handovers, missed, briefs] = await Promise.all([
    computeHealth(ctx.supabase, ws),
    ctx.supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', me).eq('workspace_id', ws).is('read_at', null),
    ctx.supabase
      .from('meeting_participants')
      .select('meeting:meetings!inner(id,status,scheduled_at,workspace_id)', { count: 'exact', head: true })
      .eq('user_id', me)
      .eq('meeting.workspace_id', ws)
      .eq('meeting.status', 'scheduled')
      .gte('meeting.scheduled_at', now.toISOString())
      .lte('meeting.scheduled_at', inAWeek),
    ctx.supabase.from('handovers').select('id', { count: 'exact', head: true }).eq('workspace_id', ws).eq('incoming_user_id', me).gte('completed_at', threeDaysAgo),
    ctx.supabase.from('meeting_participants').select('meeting_id, meeting:meetings!inner(status,workspace_id)').eq('user_id', me).eq('attended', false).eq('meeting.status', 'completed').eq('meeting.workspace_id', ws),
    ctx.supabase.from('ai_generations').select('target_id').eq('workspace_id', ws).eq('created_by', me).eq('generation_type', 'catch_up_brief').eq('target_type', 'meeting').eq('status', 'success'),
  ]);

  const myRisk = health.riskTasks.filter((r) => r.assignee_id === me);
  const briefed = new Set((briefs.data ?? []).map((b) => b.target_id));
  const missedWithoutBrief = (missed.data ?? []).filter((m) => !briefed.has(m.meeting_id)).length;

  return {
    tasks: { count: myRisk.length, urgent: myRisk.some((r) => r.signals.includes('overdue') || r.signals.includes('blocked')) },
    meetings: upcoming.error ? 0 : upcoming.count ?? 0,
    handovers: handovers.count ?? 0,
    briefs: ctx.role === 'viewer' ? 0 : missedWithoutBrief,
    notifications: unread.error ? 0 : unread.count ?? 0,
    performance: await performanceTrend(ctx, health.score),
  };
});
