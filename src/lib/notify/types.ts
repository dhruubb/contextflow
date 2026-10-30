export type NotificationEvent =
  | 'task_assigned'
  | 'task_reassigned'
  | 'deadline_approaching'
  | 'task_overdue'
  | 'meeting_scheduled'
  | 'handover_completed'
  | 'meeting_reminder'
  | 'meeting_rescheduled'
  | 'agenda_added'
  | 'task_completed'
  | 'task_blocked'
  | 'test';

/** Every channel (Telegram today, WhatsApp Cloud API later) implements this interface. */
export interface NotificationProvider {
  channel: 'telegram' | 'whatsapp';
  send(destination: string, title: string, message: string, link?: string): Promise<{ ok: boolean; error?: string; providerMessageId?: string }>;
}

export const PREF_COLUMN: Record<Exclude<NotificationEvent, 'test'>, string> = {
  task_assigned: 'notify_task_assigned',
  task_reassigned: 'notify_task_reassigned',
  deadline_approaching: 'notify_deadline_approaching',
  task_overdue: 'notify_task_overdue',
  meeting_scheduled: 'notify_meeting_scheduled',
  handover_completed: 'notify_handover',
  meeting_reminder: 'notify_meeting_scheduled',
  meeting_rescheduled: 'notify_meeting_scheduled',
  agenda_added: 'notify_meeting_scheduled',
  task_completed: 'notify_task_reassigned',
  task_blocked: 'notify_task_reassigned',
};
