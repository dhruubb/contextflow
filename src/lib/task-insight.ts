/** Plain-language helpers shared by the dashboard and the Continuity Engine (no server-only import). */
export type Signal = 'overdue' | 'blocked' | 'unassigned' | 'carried' | 'dueSoon' | 'missedOwner';

const DAY = 86_400_000;

export function overdueText(due: string | null | undefined) {
  if (!due) return '';
  const days = Math.max(1, Math.floor((Date.now() - new Date(due).getTime()) / DAY));
  return `Overdue by ${days} day${days === 1 ? '' : 's'}`;
}

export function dueSoonText(due: string | null | undefined) {
  if (!due) return '';
  const d = new Date(due);
  const tomorrow = new Date(Date.now() + DAY).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const day = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const when = day === today ? `today ${time}` : day === tomorrow ? `tomorrow ${time}` : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  return `Due ${when}`;
}

/** One short sentence explaining why a task needs attention. */
export function whyText(t: { signals: Signal[]; due_date: string | null; blocked_reason?: string | null; assignee_name?: string | null; source_meeting_title?: string | null; carry_count?: number; status?: string }, me?: { isOwner: boolean }) {
  const s = new Set(t.signals);
  const parts: string[] = [];
  if (s.has('overdue')) parts.push(overdueText(t.due_date));
  if (s.has('dueSoon')) parts.push(`${dueSoonText(t.due_date)}, not started`);
  if (s.has('unassigned')) parts.push('no one owns it');
  if (s.has('blocked')) parts.push(t.blocked_reason ? `blocked — waiting on ${t.blocked_reason.replace(/^waiting (on|for)\s+/i, '')}` : 'blocked');
  if (s.has('carried')) parts.push(`postponed ${t.carry_count ?? 2} meetings in a row`);
  if (s.has('missedOwner')) parts.push(`${me?.isOwner ? 'you' : t.assignee_name?.split(' ')[0] ?? 'the owner'} missed the meeting where it was agreed`);
  const text = parts.filter(Boolean).join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function severity(signals: Signal[]): 'high' | 'medium' {
  return signals.includes('overdue') || signals.includes('unassigned') ? 'high' : 'medium';
}
