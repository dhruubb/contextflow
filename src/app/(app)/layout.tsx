import { requireContext } from '@/lib/auth';
import { Shell } from '@/components/shell';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  return (
    <Shell
      user={{ name: ctx.profile.full_name, email: ctx.profile.email }}
      role={ctx.role}
      workspace={{ id: ctx.workspace.id, name: ctx.workspace.name }}
      workspaces={ctx.memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name }))}
    >
      {children}
    </Shell>
  );
}
