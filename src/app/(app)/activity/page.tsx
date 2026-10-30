import Link from 'next/link';
import { Activity } from 'lucide-react';
import { requireContext } from '@/lib/auth';
import { activityHref, activityText } from '@/lib/queries';
import { PageHeader } from '@/components/shell';
import { ActivityIcon, dayLabel } from '@/components/meta';
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
      <PageHeader title="Activity" description="Everything that happened in this workspace, newest first." />
      <div className="mb-4 flex items-center gap-1 border-b">
        {types.map(([k, l]) => (
          <Link key={k} href={k ? `/activity?type=${k}` : '/activity'}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${(type ?? '') === k ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {l}
          </Link>
        ))}
      </div>
      <Card>
        {rows.length === 0 ? (
          <div className="p-6"><Empty title="No activity yet" icon={<Activity />} /></div>
        ) : (
          Object.entries(
            rows.reduce<Record<string, typeof rows>>((acc, a) => {
              (acc[dayLabel(a.created_at)] ??= []).push(a);
              return acc;
            }, {}),
          ).map(([day, list]) => (
            <div key={day}>
              <p className="border-b bg-muted/30 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground first:rounded-t-lg">{day}</p>
              <ul className="divide-y">
                {list.map((a) => {
                  const href = activityHref(a);
                  return (
                    <li key={a.id} className="flex items-center gap-3 px-5 py-2.5">
                      <ActivityIcon action={a.action} />
                      <p className="min-w-0 flex-1 truncate text-sm">
                        <span className="font-medium">{a.actor?.full_name ?? 'System'}</span>{' '}
                        {href ? <Link href={href} className="text-muted-foreground hover:text-foreground hover:underline">{activityText(a)}</Link> : <span className="text-muted-foreground">{activityText(a)}</span>}
                      </p>
                      <Avatar name={a.actor?.full_name} className="size-5 text-[9px]" />
                      <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                        {new Date(a.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
