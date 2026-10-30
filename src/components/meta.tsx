import type { LucideIcon } from 'lucide-react';
import {
  Activity, ArrowRightLeft, Bell, CalendarDays, CalendarPlus, CheckCircle2, CircleDot, Clock, FileText, Gavel, Link2, MessageSquare,
  Pencil, Repeat2, Send, Sparkles, Trash2, Upload, UserCog, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/** Icon + short text, used instead of sentences for facts (dates, counts, owners…). */
export function Meta({ icon: Icon, children, className, title }: { icon: LucideIcon; children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex items-center gap-1 text-xs text-muted-foreground', className)}>
      <Icon className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}

/** Card section header: icon + title (+ optional count and right-hand action). */
export function SectionHeader({ icon: Icon, title, count, action, tone }: { icon?: LucideIcon; title: string; count?: number; action?: React.ReactNode; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b px-5 py-3.5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        {Icon && <Icon className={cn('size-4', tone ?? 'text-muted-foreground')} />}
        {title}
        {count !== undefined && <span className="rounded bg-muted px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">{count}</span>}
      </h2>
      {action}
    </div>
  );
}

/** Calendar-style date tile. */
export function DateTile({ date, muted }: { date: string; muted?: boolean }) {
  const d = new Date(date);
  return (
    <div className={cn('flex w-12 shrink-0 flex-col items-center rounded-md border py-1 leading-none', muted ? 'bg-muted/30 text-muted-foreground' : 'bg-card')}>
      <span className="text-[10px] font-medium uppercase text-muted-foreground">{d.toLocaleDateString('en-IN', { month: 'short', timeZone: 'Asia/Kolkata' })}</span>
      <span className="mt-0.5 text-lg font-semibold tabular-nums">{d.toLocaleDateString('en-IN', { day: 'numeric', timeZone: 'Asia/Kolkata' })}</span>
    </div>
  );
}

/** Coloured file-type badge. */
export function FileTypeIcon({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const tone = ext === 'pdf' ? 'bg-red-500/10 text-red-600 dark:text-red-400' : ext === 'docx' ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400' : 'bg-muted text-muted-foreground';
  return (
    <span className={cn('flex size-9 shrink-0 flex-col items-center justify-center rounded-md', tone)}>
      <FileText className="size-4" />
      <span className="text-[8px] font-bold uppercase leading-none">{ext}</span>
    </span>
  );
}

const ACTIVITY: Record<string, [LucideIcon, string]> = {
  'meeting.created': [CalendarPlus, 'text-indigo-500 bg-indigo-500/10'],
  'meeting.updated': [Pencil, 'text-muted-foreground bg-muted'],
  'meeting.completed': [CalendarDays, 'text-emerald-500 bg-emerald-500/10'],
  'meeting.ai_applied': [Sparkles, 'text-indigo-500 bg-indigo-500/10'],
  'task.created': [CircleDot, 'text-teal-600 bg-teal-500/10'],
  'task.updated': [Pencil, 'text-muted-foreground bg-muted'],
  'task.status_changed': [Activity, 'text-amber-500 bg-amber-500/10'],
  'task.reassigned': [UserCog, 'text-amber-500 bg-amber-500/10'],
  'task.closed': [CheckCircle2, 'text-emerald-500 bg-emerald-500/10'],
  'task.carried_forward': [ArrowRightLeft, 'text-amber-500 bg-amber-500/10'],
  'handover.completed': [Repeat2, 'text-amber-500 bg-amber-500/10'],
  'document.uploaded': [Upload, 'text-teal-600 bg-teal-500/10'],
  'document.linked': [Link2, 'text-teal-600 bg-teal-500/10'],
  'document.deleted': [Trash2, 'text-red-500 bg-red-500/10'],
  'brief.generated': [Sparkles, 'text-indigo-500 bg-indigo-500/10'],
  'member.role_changed': [UserCog, 'text-muted-foreground bg-muted'],
};
export function ActivityIcon({ action }: { action: string }) {
  const [Icon, cls] = ACTIVITY[action] ?? [MessageSquare, 'text-muted-foreground bg-muted'];
  return <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-full', cls)}><Icon className="size-3.5" /></span>;
}

const NOTIF: Record<string, LucideIcon> = {
  task_assigned: CircleDot, task_reassigned: UserCog, deadline_approaching: Clock, task_overdue: XCircle,
  meeting_scheduled: CalendarPlus, meeting_reminder: Bell, meeting_rescheduled: CalendarDays, agenda_added: ArrowRightLeft,
  handover_completed: Repeat2, task_completed: CheckCircle2, task_blocked: XCircle, test: Send,
};
export function NotificationIcon({ event }: { event: string }) {
  const Icon = NOTIF[event] ?? Bell;
  const tone = event === 'task_overdue' || event === 'task_blocked' ? 'text-red-500 bg-red-500/10' : event === 'deadline_approaching' ? 'text-amber-500 bg-amber-500/10' : event === 'task_completed' ? 'text-emerald-500 bg-emerald-500/10' : 'text-indigo-500 bg-indigo-500/10';
  return <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full', tone)}><Icon className="size-4" /></span>;
}

export { Gavel };

/** "Today", "Yesterday" or a date — for grouping feeds. */
export function dayLabel(iso: string) {
  const tz = 'Asia/Kolkata';
  const key = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: tz });
  const k = key(new Date(iso));
  if (k === key(new Date())) return 'Today';
  if (k === key(new Date(Date.now() - 86_400_000))) return 'Yesterday';
  return new Date(iso).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', timeZone: tz });
}
