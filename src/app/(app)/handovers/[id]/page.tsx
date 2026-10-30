import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { requireContext } from '@/lib/auth';
import { PageHeader } from '@/components/shell';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { StatusBadge } from '@/components/badges';
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
  const out = (h.outgoing as { full_name: string } | null)?.full_name;
  const inc = (h.incoming as { full_name: string } | null)?.full_name;

  return (
    <div className="animate-in">
      <PageHeader title={`Handover: ${out} → ${inc}`} description={`Completed ${fmtDateTime(h.completed_at)}`} actions={<Badge tone={h.status === 'completed' ? 'green' : 'amber'}>{h.status}</Badge>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="flex items-center gap-1.5"><Sparkles className="size-4 text-indigo-500" /> Handover brief for {inc}</CardTitle></CardHeader>
          <CardContent>{brief ? <HandoverBrief brief={brief} titles={titles} /> : <p className="text-sm text-muted-foreground">No AI brief was generated for this handover.</p>}</CardContent>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Transferred tasks</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {items.map((i) => i.action_item && (
                <Link key={i.action_item.id} href={`/tasks/${i.action_item.id}`} className="flex items-center justify-between gap-2 rounded p-1 text-sm hover:bg-accent">
                  <span className="truncate">{i.action_item.title}</span>
                  <StatusBadge status={i.action_item.status} />
                </Link>
              ))}
              <p className="pt-1 text-[11px] text-muted-foreground">Each task’s timeline records this handover; the previous owner stays in its history.</p>
            </CardContent>
          </Card>
          {h.notes && (
            <Card>
              <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
              <CardContent><p className="text-sm text-muted-foreground">{h.notes}</p></CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
