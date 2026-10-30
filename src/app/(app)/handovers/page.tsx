import Link from 'next/link';
import { Repeat2 } from 'lucide-react';
import { requireContext } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { getMembers } from '@/lib/queries';
import { PageHeader } from '@/components/shell';
import { Avatar, Badge, Card, Empty, Table } from '@/components/ui';
import { fmtDate } from '@/lib/utils';
import { HandoverWizard } from './handover-wizard';

export const metadata = { title: 'Handovers' };

export default async function HandoversPage({ searchParams }: { searchParams: Promise<{ task?: string; from?: string }> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const [{ data: handovers }, members, { data: openTasks }] = await Promise.all([
    ctx.supabase
      .from('handovers')
      .select('id,status,created_at,completed_at,notes,outgoing:profiles!handovers_outgoing_user_id_fkey(full_name),incoming:profiles!handovers_incoming_user_id_fkey(full_name),handover_items(id)')
      .eq('workspace_id', ctx.workspace.id)
      .order('created_at', { ascending: false }),
    getMembers(ctx),
    ctx.supabase.from('action_items').select('id,title,status,priority,due_date,assignee_id').eq('workspace_id', ctx.workspace.id).neq('status', 'done').not('assignee_id', 'is', null).order('due_date'),
  ]);
  type Row = { id: string; status: string; created_at: string; completed_at: string | null; notes: string | null; outgoing: { full_name: string } | null; incoming: { full_name: string } | null; handover_items: { id: string }[] };
  const rows = (handovers ?? []) as unknown as Row[];
  const canStart = can(ctx.role, 'handover.own');

  return (
    <div className="animate-in">
      <PageHeader
        title="Work Handovers"
        description="Transfer unfinished work with an AI-written context brief. Ownership history is preserved."
        actions={
          canStart && (
            <HandoverWizard
              members={members.filter((m) => m.role !== 'viewer').map((m) => ({ id: m.user_id, name: m.full_name }))}
              tasks={openTasks ?? []}
              selfId={ctx.user.id}
              canAny={can(ctx.role, 'handover.any')}
              initial={sp.task ? { from: sp.from, taskId: sp.task } : undefined}
            />
          )
        }
      />
      <Card>
        {rows.length === 0 ? (
          <div className="p-4"><Empty title="No handovers yet" icon={<Repeat2 />}>When someone goes on leave or changes teams, hand their open tasks over here.</Empty></div>
        ) : (
          <Table>
            <thead>
              <tr><th>From → To</th><th>Tasks</th><th>Status</th><th>Completed</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.id}>
                  <td>
                    <Link href={`/handovers/${h.id}`} className="flex items-center gap-1.5 font-medium hover:underline">
                      <Avatar name={h.outgoing?.full_name} className="size-5 text-[9px]" /> {h.outgoing?.full_name} → <Avatar name={h.incoming?.full_name} className="size-5 text-[9px]" /> {h.incoming?.full_name}
                    </Link>
                  </td>
                  <td className="text-xs">{h.handover_items.length}</td>
                  <td><Badge tone={h.status === 'completed' ? 'green' : 'amber'}>{h.status}</Badge></td>
                  <td className="text-xs text-muted-foreground">{fmtDate(h.completed_at)}</td>
                  <td className="max-w-xs truncate text-xs text-muted-foreground">{h.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
