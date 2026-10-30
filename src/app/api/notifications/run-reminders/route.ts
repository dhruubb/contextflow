import { route } from '@/lib/api';
import { runReminders } from '@/lib/reminders';

export const maxDuration = 60;

/** Leads/admins can send due reminders for their own workspace on demand (same idempotent logic as the cron). */
export const POST = route({ permission: 'task.manage_any' }, async ({ ctx, log }) => {
  return runReminders(log, ctx.workspace.id);
});
