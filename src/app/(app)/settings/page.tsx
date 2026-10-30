import { requireContext } from '@/lib/auth';
import { can, ROLE_LABEL, type Role } from '@/lib/rbac';
import { getMembers } from '@/lib/queries';
import { PageHeader } from '@/components/shell';
import { Avatar, Card } from '@/components/ui';
import { SectionHeader } from '@/components/meta';
import { Building2, Check, Lock, Mail, Minus, ShieldCheck, Users } from 'lucide-react';
import { RoleBadge } from '@/components/badges';
import { RoleSelect } from './settings-client';

export const metadata = { title: 'Settings' };

const PERMS: [string, Role[]][] = [
  ['View everything', ['admin', 'team_lead', 'member', 'viewer']],
  ['Ask the knowledge base', ['admin', 'team_lead', 'member', 'viewer']],
  ['Add notes, AI summaries & briefs', ['admin', 'team_lead', 'member']],
  ['Update & hand over own tasks', ['admin', 'team_lead', 'member']],
  ['Upload documents', ['admin', 'team_lead', 'member']],
  ['Create meetings, approve AI tasks', ['admin', 'team_lead']],
  ['Assign & reassign anyone’s work', ['admin', 'team_lead']],
  ['Manage members & roles', ['admin']],
];

export default async function SettingsPage() {
  const ctx = await requireContext();
  const members = await getMembers(ctx);
  const isAdmin = can(ctx.role, 'members.manage');

  const ROLES: Role[] = ['admin', 'team_lead', 'member', 'viewer'];
  return (
    <div className="animate-in space-y-5">
      <PageHeader title="Settings" description="Team members, roles and what each role can do." />

      <Card>
        <div className="flex items-center gap-4 px-5 py-4">
          <Avatar name={ctx.profile.full_name} className="size-11 text-sm" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{ctx.profile.full_name}</p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Mail className="size-3.5" /> {ctx.profile.email}</p>
          </div>
          <div className="text-right">
            <RoleBadge role={ctx.role} />
            <p className="mt-1 flex items-center justify-end gap-1 text-xs text-muted-foreground"><Building2 className="size-3.5" /> {ctx.workspace.name}</p>
          </div>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <SectionHeader icon={Users} title="Members" count={members.length} action={!isAdmin && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Lock className="size-3.5" /> Admins manage roles</span>} />
          <ul className="divide-y">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-5 py-3">
                <Avatar name={m.full_name} className="size-8 text-[10px]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.full_name}{m.user_id === ctx.user.id && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>}</p>
                  <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                </div>
                {isAdmin ? <RoleSelect memberId={m.id} role={m.role} /> : <RoleBadge role={m.role} />}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="lg:col-span-2">
          <SectionHeader icon={ShieldCheck} title="What each role can do" />
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="px-4 py-2 text-left font-medium" />
                  {ROLES.map((r) => <th key={r} className="px-1.5 py-2 text-center font-medium">{ROLE_LABEL[r].replace('Team ', '')}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y">
                {PERMS.map(([label, roles]) => (
                  <tr key={label}>
                    <td className="px-4 py-2.5 leading-snug">{label}</td>
                    {ROLES.map((r) => (
                      <td key={r} className="px-1.5 text-center">
                        {roles.includes(r) ? <Check className="mx-auto size-4 text-emerald-500" /> : <Minus className="mx-auto size-3.5 text-muted-foreground/40" />}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
