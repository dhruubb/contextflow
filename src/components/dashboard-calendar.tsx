'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, CheckSquare, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CalendarEvent {
  id: string;
  type: 'meeting' | 'task';
  title: string;
  at: string;
  /** meeting: scheduled | in_progress | completed | cancelled — task: todo | in_progress | blocked | done */
  status: string;
  /** meetings only: whether the current user missed it */
  missed?: boolean;
}

const TZ = 'Asia/Kolkata';
const dayKey = (d: Date | string) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function dotColor(e: CalendarEvent, todayKey: string) {
  if (e.type === 'meeting') return e.status === 'completed' ? 'bg-emerald-500' : e.status === 'cancelled' ? 'bg-muted-foreground/40' : 'bg-indigo-500';
  if (e.status === 'done') return 'bg-muted-foreground/40';
  return dayKey(e.at) < todayKey ? 'bg-red-500' : 'bg-amber-500';
}

function statusLabel(e: CalendarEvent, todayKey: string) {
  if (e.type === 'meeting') {
    if (e.status === 'completed') return e.missed ? { text: 'You missed it', cls: 'text-indigo-600 dark:text-indigo-400' } : { text: 'Happened', cls: 'text-emerald-600 dark:text-emerald-400' };
    if (e.status === 'cancelled') return { text: 'Cancelled', cls: 'text-muted-foreground' };
    if (e.status === 'in_progress') return { text: 'In progress', cls: 'text-teal-600 dark:text-teal-400' };
    return dayKey(e.at) < todayKey ? { text: 'Not marked done', cls: 'text-amber-600 dark:text-amber-400' } : { text: 'Scheduled', cls: 'text-indigo-600 dark:text-indigo-400' };
  }
  if (e.status === 'done') return { text: 'Completed', cls: 'text-emerald-600 dark:text-emerald-400' };
  return dayKey(e.at) < todayKey ? { text: 'Overdue', cls: 'text-red-600 dark:text-red-400' } : { text: 'Due', cls: 'text-amber-600 dark:text-amber-400' };
}

export function DashboardCalendar({ events }: { events: CalendarEvent[] }) {
  const todayKey = dayKey(new Date());
  const [cursor, setCursor] = useState(() => {
    const [y, m] = todayKey.split('-').map(Number);
    return { y, m: m - 1 };
  });
  const [selected, setSelected] = useState(todayKey);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const k = dayKey(e.at);
      map.set(k, [...(map.get(k) ?? []), e]);
    }
    for (const list of map.values()) list.sort((a, b) => (a.type === b.type ? a.at.localeCompare(b.at) : a.type === 'meeting' ? -1 : 1));
    return map;
  }, [events]);

  // Monday-first grid for the visible month
  const first = new Date(Date.UTC(cursor.y, cursor.m, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(cursor.y, cursor.m + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`),
  ];
  while (cells.length % 7) cells.push(null);

  const monthLabel = first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const move = (delta: number) => setCursor(({ y, m }) => ({ y: m + delta < 0 ? y - 1 : m + delta > 11 ? y + 1 : y, m: (m + delta + 12) % 12 }));
  const goToday = () => {
    const [y, m] = todayKey.split('-').map(Number);
    setCursor({ y, m: m - 1 });
    setSelected(todayKey);
  };

  const selectedEvents = byDay.get(selected) ?? [];
  const selectedLabel = new Date(`${selected}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const monthMeetings = events.filter((e) => e.type === 'meeting' && dayKey(e.at).startsWith(`${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}`)).length;

  return (
    <div>
      {/* Month header */}
      <div className="flex items-center justify-between px-5 pb-2 pt-4">
        <div>
          <p className="text-sm font-semibold">{monthLabel}</p>
          <p className="text-[11px] text-muted-foreground">{monthMeetings} meeting{monthMeetings === 1 ? '' : 's'} this month</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={goToday} className="rounded-md border px-2 py-1 text-xs hover:bg-accent">Today</button>
          <button onClick={() => move(-1)} className="rounded-md p-1 hover:bg-accent" aria-label="Previous month"><ChevronLeft className="size-4" /></button>
          <button onClick={() => move(1)} className="rounded-md p-1 hover:bg-accent" aria-label="Next month"><ChevronRight className="size-4" /></button>
        </div>
      </div>

      {/* Grid */}
      <div className="px-3">
        <div className="grid grid-cols-7 text-center text-[10px] font-medium uppercase text-muted-foreground">
          {WEEKDAYS.map((d) => <div key={d} className="py-1">{d.slice(0, 2)}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {cells.map((k, i) => {
            if (!k) return <div key={i} className="h-10" />;
            const list = byDay.get(k) ?? [];
            const isToday = k === todayKey;
            const isSel = k === selected;
            return (
              <button
                key={k}
                onClick={() => setSelected(k)}
                className={cn(
                  'flex h-10 flex-col items-center justify-center gap-0.5 rounded-md text-xs transition-colors',
                  isSel ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
                  !isSel && k < todayKey && 'text-muted-foreground',
                  isToday && !isSel && 'font-semibold text-primary ring-1 ring-primary/50',
                )}
              >
                <span className="tabular-nums leading-none">{Number(k.slice(8))}</span>
                <span className="flex h-1.5 gap-0.5">
                  {list.slice(0, 3).map((e) => (
                    <span key={e.type + e.id} className={cn('size-1.5 rounded-full', isSel ? 'bg-primary-foreground/80' : dotColor(e, todayKey))} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-2.5 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-indigo-500" />Meeting</span>
          <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-emerald-500" />Held</span>
          <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-amber-500" />Task due</span>
          <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-red-500" />Overdue</span>
        </div>
      </div>

      {/* Selected day */}
      <div className="border-t px-5 py-3.5">
        <p className="mb-2 text-xs font-semibold">{selected === todayKey ? `Today · ${selectedLabel}` : selectedLabel}</p>
        {selectedEvents.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing on this day.</p>
        ) : (
          <ul className="space-y-2">
            {selectedEvents.map((e) => {
              const s = statusLabel(e, todayKey);
              return (
                <li key={e.type + e.id}>
                  <Link href={e.type === 'meeting' ? `/meetings/${e.id}` : `/tasks/${e.id}`} className="flex items-start gap-2.5 rounded-md p-1.5 -mx-1.5 hover:bg-accent">
                    {e.type === 'meeting' ? <CalendarDays className="mt-0.5 size-3.5 shrink-0 text-indigo-500" /> : <CheckSquare className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm leading-tight">{e.title}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {e.type === 'meeting' ? new Date(e.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: TZ }) : 'Deadline'}
                        {' · '}
                        <span className={s.cls}>{s.text}</span>
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
