import Link from 'next/link';
import { ArrowRightLeft, CalendarDays, CheckCircle2, CircleDot, FileText, Gavel, MessageSquare, Pencil, Repeat2, UserRoundCog } from 'lucide-react';
import { cn, fmtDateTime } from '@/lib/utils';

export type TimelineKind = 'meeting' | 'decision' | 'created' | 'status' | 'reassigned' | 'handover' | 'carried' | 'closed' | 'comment' | 'document' | 'updated';

export interface TimelineItem {
  at: string;
  kind: TimelineKind;
  title: string;
  detail?: string | null;
  actor?: string | null;
  href?: string;
}

const ICON: Record<TimelineKind, [typeof CircleDot, string]> = {
  meeting: [CalendarDays, 'text-indigo-500 bg-indigo-500/10'],
  decision: [Gavel, 'text-indigo-500 bg-indigo-500/10'],
  created: [CircleDot, 'text-teal-600 bg-teal-500/10'],
  status: [CircleDot, 'text-muted-foreground bg-muted'],
  reassigned: [UserRoundCog, 'text-amber-600 bg-amber-500/10'],
  handover: [Repeat2, 'text-amber-600 bg-amber-500/10'],
  carried: [ArrowRightLeft, 'text-amber-600 bg-amber-500/10'],
  closed: [CheckCircle2, 'text-emerald-600 bg-emerald-500/10'],
  comment: [MessageSquare, 'text-muted-foreground bg-muted'],
  document: [FileText, 'text-teal-600 bg-teal-500/10'],
  updated: [Pencil, 'text-muted-foreground bg-muted'],
};

export function Timeline({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No history yet.</p>;
  return (
    <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[13px] before:top-2 before:w-px before:bg-border">
      {items.map((it, i) => {
        const [Icon, cls] = ICON[it.kind];
        return (
          <li key={i} className="relative flex gap-3">
            <span className={cn('z-10 flex size-7 shrink-0 items-center justify-center rounded-full ring-4 ring-card', cls)}>
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-sm">
                {it.href ? <Link href={it.href} className="font-medium hover:underline">{it.title}</Link> : <span className="font-medium">{it.title}</span>}
                {it.actor && <span className="text-muted-foreground"> · {it.actor}</span>}
              </p>
              {it.detail && <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">{it.detail}</p>}
              <p className="mt-0.5 text-[11px] text-muted-foreground">{fmtDateTime(it.at)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
