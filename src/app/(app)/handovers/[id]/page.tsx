import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, CheckSquare, Clock, NotebookText, Sparkles } from 'lucide-react';
import { requireContext } from '@/lib/auth';
import { Avatar, Card } from '@/components/ui';
import { Meta, SectionHeader } from '@/components/meta';
import { StatusIcon } from '@/components/task-icons';
import { HandoverBrief, parseHandover } from '@/components/handover-brief';
import { fmtDateTime } from '@/lib/utils';

export default async function HandoverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const { data: h } = await ctx.supabase
    .from('handovers')
    .select('*,outgoing:profiles!handovers_outgoing_user_id_fkey(full_name),incoming:profiles!handovers_incoming_user_id_fkey(full_name),handover_items(transferred,action_item:action_items(id,title,status,assignee:profiles!action_items_assignee_id_fkey(full_name)))')
    .eq('id', id)
    .eq('workspace_id', ctx.workspace.id)
    .maybeSingle();
  if (!h) notFound();

  const items = (h.handover_items ?? []) as unknown as { transferred: boolean; action_item: { id: string; title: string; status: string; assignee: { full_name: string } | null } | null }[];
  const brief = parseHandover(h.ai_summary);
  const titles = Object.fromEntries(items.filter((i) => i.action_item).map((i) => [i.action_item!.id, i.action_item!.title]));
  const out = (h.outgoing as unknown as { full_name: string } | null)?.full_name;
  const inc = (h.incoming as unknown as { full_name: string } | null)?.full_name;

  return (
    <div className="animate-in space-y-5">
      <div>
        <div className="flex items-center gap-3">
          <Avatar name={out} className="size-9 text-xs" />
          <ArrowRight className="size-5 text-muted-foreground" />
          <Avatar name={inc} className="size-9 text-xs" />
          <h1 className="ml-1 text-xl font-semibold tracking-tight">{out?.split(' ')[0]} → {inc?.split(' ')[0]}</h1>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
          <Meta icon={CheckSquare}>{items.length} task{items.length === 1 ? '' : 's'} transferred</Meta>
          <Meta icon={Clock}>{fmtDateTime(h.completed_at)}</Meta>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionHeader icon={Sparkles} tone="text-indigo-500" title={`Brief for ${inc?.split(' ')[0] ?? 'the new owner'}`} />
          <div className="p-5">{brief ? <HandoverBrief brief={brief} titles={titles} /> : <p className="text-sm text-muted-foreground">No AI brief was generated for this handover.</p>}</div>
        </Card>
        <div className="space-y-5">
          <Card>
            <SectionHeader icon={CheckSquare} title="Tasks" count={items.length} />
            <ul className="divide-y">
              {items.map((i) => i.action_item && (
                <li key={i.action_item.id}>
                  <Link href={`/tasks/${i.action_item.id}`} className="flex items-center gap-2.5 px-5 py-2.5 text-sm hover:bg-accent/50">
                    <StatusIcon status={i.action_item.status} />
                    <span className="min-w-0 flex-1 truncate">{i.action_item.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="border-t px-5 py-2.5 text-[11px] text-muted-foreground">Each task’s history keeps the previous owner.</p>
          </Card>
          {h.notes && (
            <Card>
              <SectionHeader icon={NotebookText} title="Note" />
              <p className="px-5 py-4 text-sm text-muted-foreground">{h.notes}</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
