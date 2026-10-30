import { cn } from '@/lib/utils';

/** Linear-style status glyphs. */
export function StatusIcon({ status, className }: { status: string; className?: string }) {
  const c = cn('size-3.5 shrink-0', className);
  switch (status) {
    case 'in_progress':
      return (
        <svg viewBox="0 0 14 14" className={c} aria-hidden>
          <circle cx="7" cy="7" r="6" fill="none" stroke="#f59e0b" strokeWidth="1.5" />
          <path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill="#f59e0b" />
        </svg>
      );
    case 'blocked':
      return (
        <svg viewBox="0 0 14 14" className={c} aria-hidden>
          <circle cx="7" cy="7" r="6" fill="none" stroke="#ef4444" strokeWidth="1.5" />
          <path d="M4.5 7h5" stroke="#ef4444" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case 'done':
      return (
        <svg viewBox="0 0 14 14" className={c} aria-hidden>
          <circle cx="7" cy="7" r="6.5" fill="#10b981" />
          <path d="m4.3 7.2 1.9 1.9 3.6-3.8" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 14 14" className={c} aria-hidden>
          <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.6 2" className="text-muted-foreground" />
        </svg>
      );
  }
}

export const STATUS_TEXT: Record<string, string> = { todo: 'To Do', in_progress: 'In Progress', blocked: 'Blocked', done: 'Done' };
export const PRIORITY_TEXT: Record<string, string> = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' };

/** Signal-bar priority glyph + label. */
export function PriorityIcon({ priority, withLabel = true }: { priority: string; withLabel?: boolean }) {
  const level = { low: 1, medium: 2, high: 3 }[priority] ?? 0;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      {priority === 'urgent' ? (
        <svg viewBox="0 0 14 14" className="size-3.5" aria-hidden>
          <rect x="1" y="1" width="12" height="12" rx="3" fill="#ef4444" />
          <path d="M7 3.8v4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="7" cy="10.2" r="0.9" fill="#fff" />
        </svg>
      ) : (
        <svg viewBox="0 0 14 14" className="size-3.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <rect key={i} x={1.5 + i * 4} y={9 - i * 3} width="3" height={4 + i * 3} rx="0.8" className={i < level ? 'fill-foreground/80' : 'fill-foreground/15'} />
          ))}
        </svg>
      )}
      {withLabel && <span className={cn(priority === 'urgent' && 'font-medium text-red-600 dark:text-red-400')}>{PRIORITY_TEXT[priority] ?? priority}</span>}
    </span>
  );
}
