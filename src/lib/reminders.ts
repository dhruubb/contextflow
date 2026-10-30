import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { notify, type NotifyOutcome } from '@/lib/notify';
import type { Logger } from '@/lib/logger';

const fmt = (d: string) => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

/**
 * Time-based notifications (idempotent — safe to run as often as you like):
 *  - deadline approaching: open tasks due within the next 36h → once per task + due date
 *  - overdue: open tasks past due → at most once per task per day
 *  - meeting reminder: scheduled meetings starting within the next 24h → once per meeting + participant
 * Uses the service role (no user session: cron). Optionally scoped to one workspace.
 */
export async function runReminders(log: Logger, workspaceId?: string) {
  const db = supabaseAdmin();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const results: Record<string, number> = {};
  const count = (o: NotifyOutcome) => (results[o] = (results[o] ?? 0) + 1);

  // Tasks
  let tq = db
    .from('action_items')
    .select('id,title,due_date,assignee_id,workspace_id')
    .neq('status', 'done')
    .not('assignee_id', 'is', null)
    .not('due_date', 'is', null)
    .lte('due_date', new Date(now.getTime() + 36 * 3600_000).toISOString());
  if (workspaceId) tq = tq.eq('workspace_id', workspaceId);
  const { data: tasks, error } = await tq;
  if (error) throw new Error(error.message);

  for (const t of tasks ?? []) {
    const overdue = new Date(t.due_date).getTime() < now.getTime();
    count(
      await notify(
        {
          workspaceId: t.workspace_id,
          userId: t.assignee_id,
          event: overdue ? 'task_overdue' : 'deadline_approaching',
          title: overdue ? '⚠️ Task overdue' : '⏰ Deadline approaching',
          message: overdue ? `"${t.title}" was due ${fmt(t.due_date)} IST and is still open.` : `"${t.title}" is due ${fmt(t.due_date)} IST.`,
          targetType: 'action_item',
          targetId: t.id,
          linkPath: `/tasks/${t.id}`,
          dedupeKey: overdue ? `overdue:${t.id}:${today}` : `deadline:${t.id}:${new Date(t.due_date).toISOString()}`,
        },
        log,
      ),
    );
  }

  // Meetings starting within 24h
  let mq = db
    .from('meetings')
    .select('id,title,scheduled_at,workspace_id,meeting_participants(user_id),meeting_action_items(is_carried_forward)')
    .eq('status', 'scheduled')
    .gte('scheduled_at', now.toISOString())
    .lte('scheduled_at', new Date(now.getTime() + 24 * 3600_000).toISOString());
  if (workspaceId) mq = mq.eq('workspace_id', workspaceId);
  const { data: meetings } = await mq;
  for (const m of (meetings ?? []) as { id: string; title: string; scheduled_at: string; workspace_id: string; meeting_participants: { user_id: string }[]; meeting_action_items: { is_carried_forward: boolean }[] }[]) {
    const carried = m.meeting_action_items.filter((x) => x.is_carried_forward).length;
    for (const p of m.meeting_participants) {
      count(
        await notify(
          {
            workspaceId: m.workspace_id,
            userId: p.user_id,
            event: 'meeting_reminder',
            title: '📅 Meeting soon',
            message: `"${m.title}" starts ${fmt(m.scheduled_at)} IST · ${m.meeting_action_items.length} item(s) on the agenda${carried ? `, ${carried} carried forward` : ''}.`,
            targetType: 'meeting',
            targetId: m.id,
            linkPath: `/meetings/${m.id}`,
            dedupeKey: `meetrem:${m.id}:${p.user_id}:${m.scheduled_at}`,
          },
          log,
        ),
      );
    }
  }

  log.info({ tasks: tasks?.length ?? 0, meetings: meetings?.length ?? 0, results, workspaceId }, 'reminders run');
  return { tasksChecked: tasks?.length ?? 0, meetingsChecked: meetings?.length ?? 0, results };
}
