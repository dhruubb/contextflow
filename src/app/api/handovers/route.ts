import { z } from 'zod';
import { route, dbError, forbidden, zId } from '@/lib/api';
import { can } from '@/lib/rbac';
import { logActivity } from '@/lib/activity';
import { notify } from '@/lib/notify';

const HandoverZ = z.object({
  outgoing_user_id: zId,
  incoming_user_id: zId,
  task_ids: z.array(zId).min(1).max(30),
  ai_summary: z.string().max(30_000).nullish(),
  notes: z.string().trim().max(4000).nullish(),
});

/** Confirms a handover: atomically reassigns tasks, records history, then notifies the incoming owner. */
export const POST = route({ body: HandoverZ, permission: 'handover.own' }, async ({ ctx, body, log }) => {
  if (!can(ctx.role, 'handover.any') && body.outgoing_user_id !== ctx.user.id) throw forbidden('Members can only hand over their own tasks');

  const { data: handoverId, error } = await ctx.supabase.rpc('perform_handover', {
    p_workspace: ctx.workspace.id,
    p_outgoing: body.outgoing_user_id,
    p_incoming: body.incoming_user_id,
    p_task_ids: body.task_ids,
    p_ai_summary: body.ai_summary ?? null,
    p_notes: body.notes ?? null,
  });
  const e = dbError(error, 'performing handover');
  if (e) throw e;

  const { data: items } = await ctx.supabase.from('handover_items').select('action_item:action_items(title)').eq('handover_id', handoverId);
  const titles = ((items ?? []) as unknown as { action_item: { title: string } | null }[]).map((i) => i.action_item?.title).filter(Boolean) as string[];
  const { data: people } = await ctx.supabase.from('profiles').select('id,full_name').in('id', [body.outgoing_user_id, body.incoming_user_id]);
  const name = (id: string) => people?.find((p) => p.id === id)?.full_name ?? 'someone';

  await logActivity(ctx, 'handover.completed', 'handover', handoverId as string, { from: name(body.outgoing_user_id), to: name(body.incoming_user_id), tasks: titles.length }, log);
  log.info({ handoverId, tasks: titles.length, from: body.outgoing_user_id, to: body.incoming_user_id }, 'handover completed');

  await notify(
    {
      workspaceId: ctx.workspace.id,
      userId: body.incoming_user_id,
      actorId: ctx.user.id,
      event: 'handover_completed',
      title: `Handover from ${name(body.outgoing_user_id)}`,
      message: `You now own ${titles.length} task(s): ${titles.slice(0, 5).join('; ')}${titles.length > 5 ? '…' : ''}. An AI handover brief is attached in ContextFlow.`,
      targetType: 'handover',
      targetId: handoverId as string,
      linkPath: `/handovers/${handoverId}`,
      dedupeKey: `handover:${handoverId}`,
    },
    log,
  );
  return { handoverId, transferred: titles.length };
});
