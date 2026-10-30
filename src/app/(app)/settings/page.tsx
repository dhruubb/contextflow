import { requireContext } from '@/lib/auth';
import { can, ROLE_LABEL, type Role } from '@/lib/rbac';
import { getMembers } from '@/lib/queries';
import { PageHeader } from '@/components/shell';
import { Avatar, Card, CardContent, CardDescription, CardHeader, CardTitle, Table } from '@/components/ui';
import { RoleBadge } from '@/components/badges';
import { RoleSelect } from './settings-client';

export const metadata = { title: 'Settings' };

const PERMS: [string, Role[]][] = [
  ['Create & edit meetings, approve AI extraction', ['admin', 'team_lead']],
  ['Add meeting notes, run AI extraction, generate briefs', ['admin', 'team_lead', 'member']],
  ['Manage any task, reassign, hand over anyone’s work', ['admin', 'team_lead']],
  ['Update own tasks, hand over own work, upload documents', ['admin', 'team_lead', 'member']],
  ['Read everything in the workspace', ['admin', 'team_lead', 'member', 'viewer']],
  ['Manage members & roles', ['admin']],
];

export default async function SettingsPage() {
  const ctx = await requireContext();
  const members = await getMembers(ctx);
  const isAdmin = can(ctx.role, 'members.manage');

  return (
    <div className="animate-in">
      <PageHeader title="Settings" description={`${ctx.workspace.name} · workspace id ${ctx.workspace.id.slice(0, 8)}…`} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Members</CardTitle>
              <CardDescription>{isAdmin ? 'Change roles. Enforced server-side and by Postgres RLS.' : 'Only admins can change roles.'}</CardDescription>
            </div>
          </CardHeader>
          <Table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td><span className="flex items-center gap-2"><Avatar name={m.full_name} />{m.full_name}{m.user_id === ctx.user.id && <span className="text-xs text-muted-foreground">(you)</span>}</span></td>
                  <td className="text-xs text-muted-foreground">{m.email}</td>
                  <td>{isAdmin ? <RoleSelect memberId={m.id} role={m.role} /> : <RoleBadge role={m.role} />}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Your profile</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="font-medium">{ctx.profile.full_name}</p>
              <p className="text-xs text-muted-foreground">{ctx.profile.email}</p>
              <RoleBadge role={ctx.role} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Role permissions</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-2 text-xs">
                {PERMS.map(([label, roles]) => (
                  <li key={label}>
                    <p>{label}</p>
                    <p className="text-muted-foreground">{roles.map((r) => ROLE_LABEL[r]).join(' · ')}</p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
