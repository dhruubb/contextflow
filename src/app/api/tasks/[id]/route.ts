import { route } from '@/lib/api';
import { updateTask, UpdateTaskZ } from '@/lib/tasks';

export const PATCH = route({ body: UpdateTaskZ, permission: 'task.update_own' }, async ({ ctx, body, params, log }) => {
  return { task: await updateTask(ctx, params.id, body, log) };
});
