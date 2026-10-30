import Link from 'next/link';
import { Bell, CheckCheck, Clock, Send, XCircle } from 'lucide-react';
import { NotificationIcon, SectionHeader, dayLabel } from '@/components/meta';
import { requireContext } from '@/lib/auth';
import { PageHeader } from '@/components/shell';
import { Badge, Card, CardContent, CardHeader, CardTitle, Empty, Table } from '@/components/ui';
import { fmtDateTime } from '@/lib/utils';
import { Preferences, RunReminders, TelegramConnect } from './notifications-client';
import { can } from '@/lib/rbac';
import { RefreshOnMount } from '@/components/refresh-on-mount';

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
    ctx.supabase.from('notifications').select('*').eq('user_id', ctx.user.id).eq('workspace_id', ctx.workspace.id).order('created_at', { ascending: false }).limit(50),
  ]);
  // Opening this page marks everything as read (clears the sidebar badge). No-op before migration 004.
  const unreadIds = new Set((history ?? []).filter((n) => n.read_at === null).map((n) => n.id as string));
  if (unreadIds.size) await ctx.supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', ctx.user.id).is('read_at', null);
  const p = prefs ?? { notify_task_assigned: true, notify_task_reassigned: true, notify_deadline_approaching: true, notify_task_overdue: true, notify_meeting_scheduled: true, notify_handover: true };

  return (
    <div className="animate-in">
      {unreadIds.size > 0 && <RefreshOnMount />}
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
          <SectionHeader icon={Bell} title="Inbox" count={(history ?? []).length} action={unreadIds.size > 0 ? <span className="text-xs font-medium text-red-500">{unreadIds.size} new</span> : undefined} />
          {(history ?? []).length === 0 ? (
            <div className="p-6"><Empty title="No notifications yet" icon={<Bell />}>Assignments, deadlines, meetings and handovers will show up here.</Empty></div>
          ) : (
            <div>
              {Object.entries(
                (history ?? []).reduce<Record<string, typeof history>>((acc, n) => {
                  const k = dayLabel(n.sent_at ?? n.created_at);
                  (acc[k] ??= []).push(n);
                  return acc;
                }, {}),
              ).map(([day, list]) => (
                <div key={day}>
                  <p className="border-b bg-muted/30 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{day}</p>
                  <ul className="divide-y">
                    {(list ?? []).map((n) => {
                      const target = n.target_type === 'action_item' ? `/tasks/${n.target_id}` : n.target_type === 'meeting' ? `/meetings/${n.target_id}` : n.target_type === 'handover' ? `/handovers/${n.target_id}` : null;
                      const row = (
                        <div className={`flex items-start gap-3 px-5 py-3 ${target ? 'hover:bg-accent/40' : ''}`}>
                          <NotificationIcon event={n.event_type} />
                          <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-1.5 text-sm font-medium">
                              {unreadIds.has(n.id) && <span className="size-1.5 shrink-0 rounded-full bg-red-500" title="New" />}
                              {n.title}
                            </p>
                            <p className="line-clamp-2 text-xs text-muted-foreground">{n.message}</p>
                            {n.error_message && <p className="mt-0.5 text-xs text-red-500">{n.error_message}</p>}
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <span className="text-[11px] text-muted-foreground">{new Date(n.sent_at ?? n.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}</span>
                            <span
                              title={n.channel === 'telegram' ? `Telegram: ${n.status}` : 'Shown in app (Telegram not connected)'}
                              className={`inline-flex items-center gap-1 text-[11px] ${n.status === 'failed' ? 'text-red-500' : n.status === 'pending' ? 'text-amber-500' : 'text-muted-foreground'}`}
                            >
                              {n.channel === 'telegram' ? <Send className="size-3" /> : <Bell className="size-3" />}
                              {n.status === 'delivered' ? <CheckCheck className="size-3 text-emerald-500" /> : n.status === 'failed' ? <XCircle className="size-3" /> : <Clock className="size-3" />}
                            </span>
                          </div>
                        </div>
                      );
                      return <li key={n.id}>{target ? <Link href={target}>{row}</Link> : row}</li>;
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
