import Link from 'next/link';
import { CalendarDays, Search } from 'lucide-react';
import { requireContext } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { getMembers } from '@/lib/queries';
import { PageHeader } from '@/components/shell';
import { Card, Empty, Input, Table } from '@/components/ui';
import { MeetingStatusBadge } from '@/components/badges';
import { NewMeetingButton } from './new-meeting';
import { fmtDateTime } from '@/lib/utils';

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

  return (
    <div className="animate-in">
      <PageHeader
        title="Meetings"
        description="Agendas, attendance, notes, AI recaps and carried-forward work."
        actions={can(ctx.role, 'meeting.create') && <NewMeetingButton members={members.map((m) => ({ id: m.user_id, name: m.full_name }))} openTasks={openTasks ?? []} selfId={ctx.user.id} />}
      />
      <form className="relative mb-3 max-w-sm">
        <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input name="q" defaultValue={q} placeholder="Search meeting notes, agendas, summaries…" className="pl-8" />
      </form>
      <Card>
        {rows.length === 0 ? (
          <div className="p-4">
            <Empty title={q ? 'No meetings match your search' : 'No meetings yet'} icon={<CalendarDays />}>
              {can(ctx.role, 'meeting.create') ? 'Create the first meeting to start capturing context.' : 'Meetings created by your team lead appear here.'}
            </Empty>
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Meeting</th>
                <th>When</th>
                <th>Status</th>
                <th>Attendance</th>
                <th>Tasks</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const mine = m.meeting_participants.find((p) => p.user_id === ctx.user.id);
                const carried = m.meeting_action_items.filter((x) => x.is_carried_forward).length;
                return (
                  <tr key={m.id}>
                    <td className="max-w-md">
                      <Link href={`/meetings/${m.id}`} className="font-medium hover:underline">{m.title}</Link>
                      {m.summary && <p className="truncate text-xs text-muted-foreground">{m.summary}</p>}
                    </td>
                    <td className="whitespace-nowrap text-xs text-muted-foreground">{fmtDateTime(m.scheduled_at)}</td>
                    <td><MeetingStatusBadge status={m.status} /></td>
                    <td className="whitespace-nowrap text-xs text-muted-foreground">
                      {m.status === 'completed' ? `${m.meeting_participants.filter((p) => p.attended).length}/${m.meeting_participants.length}` : `${m.meeting_participants.length} invited`}
                      {m.status === 'completed' && mine && !mine.attended && <span className="ml-1.5 text-indigo-600 dark:text-indigo-400">· you missed it</span>}
                    </td>
                    <td className="whitespace-nowrap text-xs text-muted-foreground">
                      {m.meeting_action_items.length}
                      {carried > 0 && <span className="ml-1 text-amber-600 dark:text-amber-400">({carried} carried)</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
