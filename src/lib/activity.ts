import 'server-only';
import type { AppContext } from '@/lib/auth';
import type { Logger } from '@/lib/logger';

export async function logActivity(
  ctx: AppContext,
  action: string,
  targetType: string,
  targetId: string | null,
  metadata: Record<string, unknown> = {},
  log?: Logger,
) {
  const { error } = await ctx.supabase.from('activity_events').insert({
    workspace_id: ctx.workspace.id,
    actor_id: ctx.user.id,
    action,
    target_type: targetType,
    target_id: targetId,
    metadata,
  });
  if (error) log?.warn({ error: error.message, action }, 'activity event not recorded');
  log?.info({ action, targetType, targetId }, 'activity');
}
