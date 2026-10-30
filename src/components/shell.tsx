'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import {
  Activity, Bell, BookOpen, CalendarDays, CheckSquare, ChevronsUpDown, LayoutDashboard, LogOut, Menu, Moon,
  Repeat2, Settings, Sparkles, Sun, Waypoints, HeartPulse,
} from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { api } from '@/lib/client-api';
import { Avatar } from '@/components/ui';
import { RoleBadge } from '@/components/badges';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/meetings', label: 'Meetings', icon: CalendarDays },
  { href: '/tasks', label: 'Action Items', icon: CheckSquare },
  { href: '/handovers', label: 'Handovers', icon: Repeat2 },
  { href: '/knowledge', label: 'Knowledge Base', icon: BookOpen },
  { href: '/briefs', label: 'AI Briefs', icon: Sparkles },
  { href: '/continuity', label: 'Continuity Engine', icon: HeartPulse },
  { href: '/notifications', label: 'Notifications', icon: Bell },
  { href: '/activity', label: 'Activity', icon: Activity },
  { href: '/settings', label: 'Settings', icon: Settings },
];

interface ShellProps {
  user: { name: string; email: string };
  role: string;
  workspace: { id: string; name: string };
  workspaces: { id: string; name: string }[];
  children: React.ReactNode;
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <button
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      aria-label="Toggle theme"
    >
      {mounted && resolvedTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

export function Shell({ user, role, workspace, workspaces, children }: ShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [wsOpen, setWsOpen] = useState(false);

  async function signOut() {
    await createClient().auth.signOut();
    router.replace('/login');
    router.refresh();
  }
  async function switchWs(id: string) {
    try {
      await api('/api/workspace/switch', { body: { workspace_id: id } });
      setWsOpen(false);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="relative border-b p-3">
        <button onClick={() => setWsOpen((v) => !v)} className="flex w-full items-center gap-2 rounded-md p-1.5 text-left hover:bg-accent">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Waypoints className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{workspace.name}</p>
            <p className="text-[11px] text-muted-foreground">ContextFlow AI</p>
          </div>
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        </button>
        {wsOpen && (
          <div className="animate-in absolute left-3 right-3 top-full z-20 mt-1 rounded-md border bg-card p-1 shadow-lg">
            {workspaces.map((w) => (
              <button key={w.id} onClick={() => switchWs(w.id)} className={cn('w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent', w.id === workspace.id && 'font-medium text-primary')}>
                {w.name}
              </button>
            ))}
            <Link href="/onboarding" className="block rounded px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent">
              + New workspace
            </Link>
          </div>
        )}
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
              isActive(href) ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            )}
          >
            <Icon className={cn('size-4', isActive(href) && 'text-primary')} />
            {label}
          </Link>
        ))}
      </nav>
      <div className="border-t p-3">
        <div className="flex items-center gap-2">
          <Avatar name={user.name} className="size-7" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <RoleBadge role={role} />
          </div>
          <ThemeToggle />
          <button onClick={signOut} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Sign out" title="Sign out">
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r bg-[hsl(var(--sidebar))] md:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setOpen(false)}>
          <aside className="h-full w-64 border-r bg-[hsl(var(--sidebar))]" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-30 flex items-center gap-2 border-b bg-background/80 px-4 py-2 backdrop-blur md:hidden">
          <button onClick={() => setOpen(true)} className="rounded p-1 hover:bg-accent" aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <span className="text-sm font-semibold">{workspace.name}</span>
        </div>
        <main className="mx-auto max-w-6xl px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
