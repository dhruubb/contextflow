import { z } from 'zod';
import { route, ApiError, forbidden, zId } from '@/lib/api';
import { can } from '@/lib/rbac';
import { generateJSON } from '@/lib/ai/groq';
import { HandoverZ, handoverPrompt } from '@/lib/ai/prompts';
import { gatherHandoverContext } from '@/lib/handover-context';

const PreviewZ = z.object({ outgoing_user_id: zId, incoming_user_id: zId, task_ids: z.array(zId).min(1).max(30) });

/** Generates the AI handover brief for review. Nothing is transferred yet. */
export const POST = route({ body: PreviewZ, permission: 'handover.own' }, async ({ ctx, body, log }) => {
  if (!can(ctx.role, 'handover.any') && body.outgoing_user_id !== ctx.user.id) throw forbidden('Members can only hand over their own tasks');
  if (body.outgoing_user_id === body.incoming_user_id) throw new ApiError(400, 'Choose two different people');

  const context = await gatherHandoverContext(ctx, body.outgoing_user_id, body.incoming_user_id, body.task_ids);
  if (context.tasks.length === 0) throw new ApiError(400, 'No matching tasks found');

  const prompt = handoverPrompt(context);
  const result = await generateJSON({ ctx, type: 'handover_context', schema: HandoverZ, system: prompt.system, user: prompt.user, log, temperature: 0.3 });
  if (!result.ok) throw new ApiError(502, result.error);

  const valid = new Set(context.tasks.map((t) => t.task_id));
  return { handover: { ...result.data, tasks: result.data.tasks.filter((t) => valid.has(t.task_id)) }, generationId: result.generationId };
});
