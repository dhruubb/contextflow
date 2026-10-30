import Link from 'next/link';
import { Activity } from 'lucide-react';
import { requireContext } from '@/lib/auth';
import { activityHref, activityText } from '@/lib/queries';
import { PageHeader } from '@/components/shell';
import { Avatar, Badge, Card, CardContent, Empty } from '@/components/ui';
import { fmtDateTime } from '@/lib/utils';

export const metadata = { title: 'Activity' };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const ctx = await requireContext();
  const { type } = await searchParams;
  let q = ctx.supabase.from('activity_events').select('id,action,metadata,target_type,target_id,created_at,actor:profiles(full_name)').eq('workspace_id', ctx.workspace.id).order('created_at', { ascending: false }).limit(150);
  if (type) q = q.eq('target_type', type);
  const { data } = await q;
  const rows = (data ?? []) as unknown as { id: string; action: string; metadata: Record<string, unknown>; target_type: string; target_id: string | null; created_at: string; actor: { full_name: string } | null }[];
  const types = [['', 'All'], ['meeting', 'Meetings'], ['action_item', 'Tasks'], ['handover', 'Handovers'], ['document', 'Documents']];

  return (
    <div className="animate-in">
      <PageHeader title="Activity" description="Audit trail of everything that happened in this workspace." />
      <div className="mb-3 flex gap-1.5">
        {types.map(([k, l]) => (
          <Link key={k} href={k ? `/activity?type=${k}` : '/activity'}><Badge tone={(type ?? '') === k ? 'teal' : 'neutral'} className="cursor-pointer px-2 py-1 text-xs">{l}</Badge></Link>
        ))}
      </div>
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="p-4"><Empty title="No activity yet" icon={<Activity />} /></div>
          ) : (
            <ul className="divide-y">
              {rows.map((a) => {
                const href = activityHref(a);
                return (
                  <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <Avatar name={a.actor?.full_name} />
                    <span className="flex-1">
                      <span className="font-medium">{a.actor?.full_name ?? 'System'}</span> {href ? <Link href={href} className="hover:underline">{activityText(a)}</Link> : activityText(a)}
                    </span>
                    <span className="whitespace-nowrap text-xs text-muted-foreground">{fmtDateTime(a.created_at)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
