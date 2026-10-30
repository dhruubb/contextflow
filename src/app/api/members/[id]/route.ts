import { z } from 'zod';
import { route, check, ApiError, notFound } from '@/lib/api';
import { logActivity } from '@/lib/activity';

const RoleZ = z.object({ role: z.enum(['admin', 'team_lead', 'member', 'viewer']) });

/** Admin-only: change a member's role. Prevents removing the last admin. */
export const PATCH = route({ body: RoleZ, permission: 'members.manage' }, async ({ ctx, body, params, log }) => {
  const member = check(
    await ctx.supabase.from('workspace_members').select('id,user_id,role').eq('id', params.id).eq('workspace_id', ctx.workspace.id).maybeSingle(),
    'loading member',
  );
  if (!member) throw notFound('Member');
  if (member.role === 'admin' && body.role !== 'admin') {
    const { count } = await ctx.supabase.from('workspace_members').select('id', { count: 'exact', head: true }).eq('workspace_id', ctx.workspace.id).eq('role', 'admin');
    if ((count ?? 0) <= 1) throw new ApiError(400, 'A workspace needs at least one admin');
  }
  check(await ctx.supabase.from('workspace_members').update({ role: body.role }).eq('id', member.id), 'updating role');
  await logActivity(ctx, 'member.role_changed', 'member', member.user_id, { from: member.role, to: body.role }, log);
  return { ok: true };
});
