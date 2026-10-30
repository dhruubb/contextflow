import { Bell } from 'lucide-react';
import { requireContext } from '@/lib/auth';
import { PageHeader } from '@/components/shell';
import { Badge, Card, CardContent, CardHeader, CardTitle, Empty, Table } from '@/components/ui';
import { fmtDateTime } from '@/lib/utils';
import { Preferences, RunReminders, TelegramConnect } from './notifications-client';
import { can } from '@/lib/rbac';

export const metadata = { title: 'Notifications' };

const EVENT_LABEL: Record<string, string> = {
  task_assigned: 'Task assigned', task_reassigned: 'Task reassigned', deadline_approaching: 'Deadline approaching', task_overdue: 'Task overdue',
  meeting_scheduled: 'Meeting scheduled', handover_completed: 'Handover', test: 'Test',
  meeting_reminder: 'Meeting reminder', meeting_rescheduled: 'Meeting rescheduled', agenda_added: 'Added to agenda', task_completed: 'Task completed', task_blocked: 'Task blocked',
};

export default async function NotificationsPage() {
  const ctx = await requireContext();
  const [{ data: conn }, { data: prefs }, { data: history }] = await Promise.all([
    ctx.supabase.from('notification_connections').select('is_verified,verified_at,telegram_username,token_expires_at').eq('user_id', ctx.user.id).eq('channel', 'telegram').maybeSingle(),
    ctx.supabase.from('notification_preferences').select('*').eq('user_id', ctx.user.id).eq('channel', 'telegram').maybeSingle(),
    ctx.supabase.from('notifications').select('id,channel,title,message,event_type,status,error_message,sent_at,created_at').eq('user_id', ctx.user.id).eq('workspace_id', ctx.workspace.id).order('created_at', { ascending: false }).limit(50),
  ]);
  const p = prefs ?? { notify_task_assigned: true, notify_task_reassigned: true, notify_deadline_approaching: true, notify_task_overdue: true, notify_meeting_scheduled: true, notify_handover: true };

  return (
    <div className="animate-in">
      <PageHeader title="Notifications" description="Telegram alerts for assignments, deadlines and handovers — with full delivery history." />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <TelegramConnect connected={!!conn?.is_verified} username={conn?.telegram_username ?? null} verifiedAt={conn?.verified_at ?? null} />
          <Preferences
            initial={{
              notify_task_assigned: p.notify_task_assigned ?? true,
              notify_task_reassigned: p.notify_task_reassigned ?? true,
              notify_deadline_approaching: p.notify_deadline_approaching ?? true,
              notify_task_overdue: p.notify_task_overdue ?? true,
              notify_meeting_scheduled: p.notify_meeting_scheduled ?? true,
              notify_handover: p.notify_handover ?? true,
            }}
          />
          {can(ctx.role, 'task.manage_any') && <RunReminders />}
          <Card>
            <CardHeader><CardTitle>WhatsApp</CardTitle></CardHeader>
            <CardContent className="text-xs text-muted-foreground">Optional channel, not enabled. The provider interface (<code>lib/notify/types.ts</code>) is ready for WhatsApp Cloud API; it requires user opt-in and Meta-approved message templates.</CardContent>
          </Card>
        </div>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>History & delivery status</CardTitle></CardHeader>
          {(history ?? []).length === 0 ? (
            <CardContent><Empty title="No notifications yet" icon={<Bell />}>You’ll see every alert here, including whether Telegram delivered it.</Empty></CardContent>
          ) : (
            <Table>
              <thead><tr><th>Event</th><th>Message</th><th>Channel</th><th>Status</th><th>When</th></tr></thead>
              <tbody>
                {(history ?? []).map((n) => (
                  <tr key={n.id}>
                    <td className="whitespace-nowrap text-xs font-medium">{EVENT_LABEL[n.event_type] ?? n.event_type}</td>
                    <td className="max-w-sm text-xs text-muted-foreground"><p className="font-medium text-foreground">{n.title}</p>{n.message}{n.error_message && <p className="text-red-500">Error: {n.error_message}</p>}</td>
                    <td><Badge tone={n.channel === 'telegram' ? 'indigo' : 'neutral'}>{n.channel === 'in_app' ? 'in-app' : n.channel}</Badge></td>
                    <td><Badge tone={n.status === 'delivered' ? 'green' : n.status === 'failed' ? 'red' : 'amber'}>{n.status}</Badge></td>
                    <td className="whitespace-nowrap text-xs text-muted-foreground">{fmtDateTime(n.sent_at ?? n.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
