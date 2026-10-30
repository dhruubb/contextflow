import { Badge } from '@/components/ui';
import { isOverdue } from '@/lib/utils';

const STATUS: Record<string, { label: string; tone: 'neutral' | 'teal' | 'indigo' | 'amber' | 'red' | 'green' }> = {
  todo: { label: 'To Do', tone: 'neutral' },
  in_progress: { label: 'In Progress', tone: 'indigo' },
  blocked: { label: 'Blocked', tone: 'amber' },
  done: { label: 'Done', tone: 'green' },
};
const PRIORITY: Record<string, { label: string; tone: 'neutral' | 'teal' | 'indigo' | 'amber' | 'red' }> = {
  low: { label: 'Low', tone: 'neutral' },
  medium: { label: 'Medium', tone: 'teal' },
  high: { label: 'High', tone: 'amber' },
  urgent: { label: 'Urgent', tone: 'red' },
};
const MEETING: Record<string, { label: string; tone: 'neutral' | 'teal' | 'indigo' | 'green' | 'red' }> = {
  scheduled: { label: 'Scheduled', tone: 'indigo' },
  in_progress: { label: 'In progress', tone: 'teal' },
  completed: { label: 'Completed', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export const STATUS_LABEL = Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [k, v.label]));

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.todo;
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
export function PriorityBadge({ priority }: { priority: string }) {
  const p = PRIORITY[priority] ?? PRIORITY.medium;
  return <Badge tone={p.tone}>{p.label}</Badge>;
}
export function MeetingStatusBadge({ status }: { status: string }) {
  const m = MEETING[status] ?? MEETING.scheduled;
  return <Badge tone={m.tone}>{m.label}</Badge>;
}
export function OverdueBadge({ due, status }: { due: string | null; status: string }) {
  return isOverdue(due, status) ? <Badge tone="red">Overdue</Badge> : null;
}
export function RoleBadge({ role }: { role: string }) {
  const map: Record<string, ['neutral' | 'teal' | 'indigo' | 'amber', string]> = {
    admin: ['indigo', 'Admin'],
    team_lead: ['teal', 'Team Lead'],
    member: ['neutral', 'Member'],
    viewer: ['amber', 'Viewer'],
  };
  const [tone, label] = map[role] ?? ['neutral', role];
  return <Badge tone={tone}>{label}</Badge>;
}
