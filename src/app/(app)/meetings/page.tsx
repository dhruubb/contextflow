import Link from 'next/link';
import { ArrowRightLeft, CalendarDays, CheckSquare, Clock, Search, Sparkles, Users } from 'lucide-react';
import { requireContext } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { getMembers } from '@/lib/queries';
import { PageHeader } from '@/components/shell';
import { Badge, Card, Empty, Input, buttonVariants } from '@/components/ui';
import { DateTile, Meta, SectionHeader } from '@/components/meta';
import { MeetingStatusBadge } from '@/components/badges';
import { NewMeetingButton } from './new-meeting';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Meetings' };

export default async function MeetingsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireContext();
  const { q } = await searchParams;
  let query = ctx.supabase
    .from('meetings')
    .select('id,title,status,scheduled_at,summary,meeting_participants(user_id,attended),meeting_action_items(is_carried_forward)')
    .eq('workspace_id', ctx.workspace.id)
    .order('scheduled_at', { ascending: false });
  if (q?.trim()) query = query.textSearch('search', q.trim(), { type: 'websearch', config: 'english' });
  const [{ data: meetings }, members, { data: openTasks }] = await Promise.all([
    query,
    getMembers(ctx),
    ctx.supabase.from('action_items').select('id,title,status,due_date').eq('workspace_id', ctx.workspace.id).neq('status', 'done').order('due_date'),
  ]);

  type Row = { id: string; title: string; status: string; scheduled_at: string; summary: string | null; meeting_participants: { user_id: string; attended: boolean }[]; meeting_action_items: { is_carried_forward: boolean }[] };
  const rows = (meetings ?? []) as unknown as Row[];
  const now = Date.now();
  const upcoming = rows.filter((m) => m.status !== 'completed' && m.status !== 'cancelled' && new Date(m.scheduled_at).getTime() >= now - 3 * 3600_000).reverse();
  const past = rows.filter((m) => !upcoming.includes(m));
  const time = (d: string) => new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

  const MeetingRow = ({ m }: { m: Row }) => {
    const mine = m.meeting_participants.find((p) => p.user_id === ctx.user.id);
    const missed = m.status === 'completed' && mine && !mine.attended;
    const carried = m.meeting_action_items.filter((x) => x.is_carried_forward).length;
    const attended = m.meeting_participants.filter((p) => p.attended).length;
    return (
      <li className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-accent/40">
        <DateTile date={m.scheduled_at} muted={m.status === 'completed'} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link href={`/meetings/${m.id}`} className="truncate text-sm font-medium hover:underline">{m.title}</Link>
            {m.status === 'completed' && <Badge tone="green" className="shrink-0">Done</Badge>}
            {m.status === 'in_progress' && <Badge tone="teal" className="shrink-0">Live</Badge>}
            {m.status === 'cancelled' && <Badge className="shrink-0">Cancelled</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3.5 gap-y-1">
            <Meta icon={Clock}>{time(m.scheduled_at)}</Meta>
            <Meta icon={Users}>{m.status === 'completed' ? `${attended}/${m.meeting_participants.length}` : m.meeting_participants.length}</Meta>
            <Meta icon={CheckSquare}>{m.meeting_action_items.length}</Meta>
            {carried > 0 && <Meta icon={ArrowRightLeft} className="text-amber-600 dark:text-amber-400">{carried} carried</Meta>}
          </div>
        </div>
        {missed ? (
          <Link href={`/briefs?meeting=${m.id}`} className={cn(buttonVariants({ size: 'sm', variant: 'secondary' }), 'shrink-0')}><Sparkles /> Catch up</Link>
        ) : (
          <Link href={`/meetings/${m.id}`} className={cn(buttonVariants({ size: 'sm', variant: 'ghost' }), 'shrink-0 text-muted-foreground')}>{m.status === 'completed' ? 'View' : 'Open'}</Link>
        )}
      </li>
    );
  };

  return (
    <div className="animate-in space-y-5">
      <PageHeader
        title="Meetings"
        description="Plan meetings, capture notes, and turn them into tasks."
        actions={can(ctx.role, 'meeting.create') && <NewMeetingButton members={members.map((m) => ({ id: m.user_id, name: m.full_name }))} openTasks={openTasks ?? []} selfId={ctx.user.id} />}
      />
      <form className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input name="q" defaultValue={q} placeholder="Search notes, agendas, summaries" className="pl-8" />
      </form>

      {rows.length === 0 ? (
        <Card className="p-6">
          <Empty title={q ? 'No meetings match your search' : 'No meetings yet'} icon={<CalendarDays />}>
            {can(ctx.role, 'meeting.create') ? 'Create the first meeting to start capturing context.' : 'Meetings created by your team lead appear here.'}
          </Empty>
        </Card>
      ) : (
        <>
          {upcoming.length > 0 && (
            <Card>
              <SectionHeader icon={CalendarDays} tone="text-indigo-500" title="Upcoming" count={upcoming.length} />
              <ul className="divide-y">{upcoming.map((m) => <MeetingRow key={m.id} m={m} />)}</ul>
            </Card>
          )}
          {past.length > 0 && (
            <Card>
              <SectionHeader icon={CheckSquare} title="Past" count={past.length} />
              <ul className="divide-y">{past.map((m) => <MeetingRow key={m.id} m={m} />)}</ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
