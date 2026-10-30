import { z } from 'zod';
import { route, zId } from '@/lib/api';
import { carryForward } from '@/lib/tasks';

const CarryZ = z.object({ task_ids: z.array(zId).min(1).max(50) });

/** Links unresolved tasks to this (upcoming) meeting. The task keeps its original id and full history. */
export const POST = route({ body: CarryZ, permission: 'meeting.carry_forward' }, async ({ ctx, body, params, log }) => {
  return carryForward(ctx, params.id, body.task_ids, log);
});
