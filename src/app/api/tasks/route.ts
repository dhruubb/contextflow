import { route } from '@/lib/api';
import { createTask, CreateTaskZ } from '@/lib/tasks';

export const POST = route({ body: CreateTaskZ, permission: 'task.create' }, async ({ ctx, body, log }) => {
  return { task: await createTask(ctx, body, log) };
});
