import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient, type SupabaseServer } from '@/lib/supabase/server';
import type { Role } from '@/lib/rbac';

export const WORKSPACE_COOKIE = 'cf_ws';

export interface Membership {
  workspace_id: string;
  role: Role;
  workspace: { id: string; name: string; slug: string };
}

export interface AppContext {
  supabase: SupabaseServer;
  user: { id: string; email: string };
  profile: { id: string; email: string; full_name: string; avatar_url: string | null };
  workspace: { id: string; name: string; slug: string };
  role: Role;
  memberships: Membership[];
}

/** Resolves the signed-in user, their workspaces and the active workspace. Cached per request. */
export const getContext = cache(async (): Promise<AppContext | null> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const [{ data: profile }, { data: rows }] = await Promise.all([
    supabase.from('profiles').select('id,email,full_name,avatar_url').eq('id', auth.user.id).maybeSingle(),
    supabase
      .from('workspace_members')
      .select('workspace_id, role, workspace:workspaces(id,name,slug)')
      .eq('user_id', auth.user.id)
      .order('created_at'),
  ]);

  const memberships = ((rows ?? []) as unknown as Membership[]).filter((m) => m.workspace);
  const fallbackProfile = {
    id: auth.user.id,
    email: auth.user.email ?? '',
    full_name: (auth.user.user_metadata?.full_name as string) || auth.user.email || 'User',
    avatar_url: null,
  };
  if (memberships.length === 0) {
    return {
      supabase,
      user: { id: auth.user.id, email: auth.user.email ?? '' },
      profile: profile ?? fallbackProfile,
      workspace: { id: '', name: '', slug: '' },
      role: 'viewer',
      memberships: [],
    };
  }

  const preferred = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  const active = memberships.find((m) => m.workspace_id === preferred) ?? memberships[0];

  return {
    supabase,
    user: { id: auth.user.id, email: auth.user.email ?? '' },
    profile: profile ?? fallbackProfile,
    workspace: active.workspace,
    role: active.role,
    memberships,
  };
});

/** For pages: redirects to /login (no session) or /onboarding (no workspace). */
export async function requireContext(): Promise<AppContext> {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  if (!ctx.workspace.id) redirect('/onboarding');
  return ctx;
}
