import { route } from '@/lib/api';
import { notify } from '@/lib/notify';

export const POST = route({ permission: 'notifications.self' }, async ({ ctx, log }) => {
  const outcome = await notify(
    {
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      event: 'test',
      title: 'ContextFlow test notification',
      message: `Hi ${ctx.profile.full_name.split(' ')[0]}, notifications for ${ctx.workspace.name} are working.`,
    },
    log,
  );
  return { outcome };
});
