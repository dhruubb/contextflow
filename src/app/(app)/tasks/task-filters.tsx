'use client';
import { useEffect, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Loader2, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Tab { key: string; label: string; count: number; alert?: boolean }

/** Linear-style tabs + instant filters (no Apply button). State lives in the URL. */
export function TaskFilters({ tabs, owners }: { tabs: Tab[]; owners: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(params.get('q') ?? '');
  const view = params.get('status') === 'done' ? 'done' : params.get('filter') ?? '';

  function update(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) (v ? sp.set(k, v) : sp.delete(k));
    start(() => router.replace(`${pathname}${sp.toString() ? `?${sp}` : ''}`, { scroll: false }));
  }

  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('q') ?? '') !== q) update({ q: q || null });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="mb-4 space-y-3">
      <div className="flex items-center gap-1 overflow-x-auto border-b">
        {tabs.map((t) => {
          const active = view === t.key;
          return (
            <button
              key={t.key}
              onClick={() => update(t.key === 'done' ? { status: 'done', filter: null } : { filter: t.key || null, status: null })}
              className={cn(
                '-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors',
                active ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
              <span className={cn('text-xs tabular-nums', t.alert && t.count > 0 ? 'font-semibold text-red-500' : 'text-muted-foreground/70')}>{t.count}</span>
            </button>
          );
        })}
        {pending && <Loader2 className="ml-2 size-3.5 animate-spin text-muted-foreground" />}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tasks"
            className="h-8 w-64 rounded-md border border-input bg-background pl-8 pr-7 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {q && <button onClick={() => setQ('')} className="absolute right-2 top-2 text-muted-foreground hover:text-foreground" aria-label="Clear"><X className="size-4" /></button>}
        </div>
        <select
          value={params.get('assignee') ?? ''}
          onChange={(e) => update({ assignee: e.target.value || null })}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">All owners</option>
          {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select
          value={params.get('sort') ?? 'due'}
          onChange={(e) => update({ sort: e.target.value === 'due' ? null : e.target.value })}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="due">Sort: deadline</option>
          <option value="priority">Sort: priority</option>
          <option value="updated">Sort: recently updated</option>
        </select>
      </div>
    </div>
  );
}
