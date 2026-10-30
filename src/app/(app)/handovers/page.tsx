import Link from 'next/link';
import { ArrowRight, CheckSquare, Clock, Repeat2, Sparkles } from 'lucide-react';
import { requireContext } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { getMembers } from '@/lib/queries';
import { PageHeader } from '@/components/shell';
import { Avatar, Card, Empty, buttonVariants } from '@/components/ui';
import { Meta, SectionHeader } from '@/components/meta';
import { cn, relTime } from '@/lib/utils';
import { HandoverWizard } from './handover-wizard';

export const metadata = { title: 'Handovers' };

export default async function HandoversPage({ searchParams }: { searchParams: Promise<{ task?: string; from?: string }> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const [{ data: handovers }, members, { data: openTasks }] = await Promise.all([
    ctx.supabase
      .from('handovers')
      .select('id,status,created_at,completed_at,notes,ai_summary,incoming_user_id,outgoing:profiles!handovers_outgoing_user_id_fkey(full_name),incoming:profiles!handovers_incoming_user_id_fkey(full_name),handover_items(id)')
      .eq('workspace_id', ctx.workspace.id)
      .order('created_at', { ascending: false }),
    getMembers(ctx),
    ctx.supabase.from('action_items').select('id,title,status,priority,due_date,assignee_id').eq('workspace_id', ctx.workspace.id).neq('status', 'done').not('assignee_id', 'is', null).order('due_date'),
  ]);
  type Row = { id: string; status: string; created_at: string; completed_at: string | null; notes: string | null; ai_summary: string | null; incoming_user_id: string; outgoing: { full_name: string } | null; incoming: { full_name: string } | null; handover_items: { id: string }[] };
  const rows = (handovers ?? []) as unknown as Row[];
  const canStart = can(ctx.role, 'handover.own');

  return (
    <div className="animate-in space-y-5">
      <PageHeader
        title="Handovers"
        description="Pass unfinished work to someone else — with an AI brief so nothing gets lost."
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
        <SectionHeader icon={Repeat2} tone="text-amber-500" title="All handovers" count={rows.length} />
        {rows.length === 0 ? (
          <div className="p-6"><Empty title="No handovers yet" icon={<Repeat2 />}>When someone goes on leave or changes teams, hand their open tasks over here.</Empty></div>
        ) : (
          <ul className="divide-y">
            {rows.map((h) => {
              const forMe = h.incoming_user_id === ctx.user.id;
              return (
                <li key={h.id} className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-accent/40">
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Avatar name={h.outgoing?.full_name} className="size-8 text-[10px]" />
                    <ArrowRight className="size-4 text-muted-foreground" />
                    <Avatar name={h.incoming?.full_name} className="size-8 text-[10px]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      <span className="font-medium">{h.outgoing?.full_name?.split(' ')[0]}</span>
                      <span className="text-muted-foreground"> handed over to </span>
                      <span className="font-medium">{forMe ? 'you' : h.incoming?.full_name?.split(' ')[0]}</span>
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3.5 gap-y-1">
                      <Meta icon={CheckSquare}>{h.handover_items.length} task{h.handover_items.length === 1 ? '' : 's'}</Meta>
                      <Meta icon={Clock}>{relTime(h.completed_at ?? h.created_at)}</Meta>
                      {h.ai_summary && <Meta icon={Sparkles} className="text-indigo-600 dark:text-indigo-400">AI brief</Meta>}
                    </div>
                  </div>
                  <Link href={`/handovers/${h.id}`} className={cn(buttonVariants({ size: 'sm', variant: forMe ? 'secondary' : 'ghost' }), 'shrink-0')}>{forMe ? 'Read brief' : 'View'}</Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
