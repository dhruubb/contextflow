import { z } from 'zod';
import { route, check } from '@/lib/api';

const PrefsZ = z.object({
  notify_task_assigned: z.boolean(),
  notify_task_reassigned: z.boolean(),
  notify_deadline_approaching: z.boolean(),
  notify_task_overdue: z.boolean(),
  notify_meeting_scheduled: z.boolean(),
  notify_handover: z.boolean(),
});

export const PUT = route({ body: PrefsZ, permission: 'notifications.self' }, async ({ ctx, body, log }) => {
  check(
    await ctx.supabase.from('notification_preferences').upsert({ user_id: ctx.user.id, channel: 'telegram', ...body }, { onConflict: 'user_id,channel' }),
    'saving preferences',
  );
  log.info({ prefs: body }, 'notification preferences updated');
  return { ok: true };
});
