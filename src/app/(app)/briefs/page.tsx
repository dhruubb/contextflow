import Link from 'next/link';
import { Repeat2, Sparkles } from 'lucide-react';
import { requireContext } from '@/lib/auth';
import { can } from '@/lib/rbac';
import type { CatchUpBrief } from '@/lib/ai/prompts';
import { PageHeader } from '@/components/shell';
import { Card, CardContent, CardHeader, CardTitle, Empty } from '@/components/ui';
import { CatchUpView } from '@/components/catchup-brief';
import { fmtDate, relTime } from '@/lib/utils';
import { BriefGenerator } from './brief-generator';

export const metadata = { title: 'AI Briefs' };

export default async function BriefsPage({ searchParams }: { searchParams: Promise<{ meeting?: string }> }) {
  const ctx = await requireContext();
  const { meeting } = await searchParams;

  const [{ data: parts }, { data: completed }, { data: past }, { data: received }] = await Promise.all([
    ctx.supabase.from('meeting_participants').select('attended,meeting:meetings!inner(id,title,scheduled_at,status,workspace_id)').eq('user_id', ctx.user.id).eq('meeting.workspace_id', ctx.workspace.id).eq('meeting.status', 'completed'),
    ctx.supabase.from('meetings').select('id,title,scheduled_at').eq('workspace_id', ctx.workspace.id).eq('status', 'completed').order('scheduled_at', { ascending: false }).limit(30),
    ctx.supabase.from('ai_generations').select('id,parsed_output,created_at,target_id').eq('workspace_id', ctx.workspace.id).eq('generation_type', 'catch_up_brief').eq('target_type', 'meeting').eq('status', 'success').eq('created_by', ctx.user.id).order('created_at', { ascending: false }).limit(10),
    ctx.supabase.from('handovers').select('id,completed_at,outgoing:profiles!handovers_outgoing_user_id_fkey(full_name),handover_items(id)').eq('workspace_id', ctx.workspace.id).eq('incoming_user_id', ctx.user.id).order('created_at', { ascending: false }).limit(5),
  ]);
  const missed = ((parts ?? []) as unknown as { attended: boolean; meeting: { id: string; title: string; scheduled_at: string } }[]).filter((p) => !p.attended).map((p) => p.meeting);
  const titles = new Map((completed ?? []).map((m) => [m.id, m.title]));
  const canGen = can(ctx.role, 'brief.generate');

  return (
    <div className="animate-in">
      <PageHeader title="AI Briefs" description="Personalized catch-ups for meetings you missed, and handover briefs for work you received." />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {canGen ? (
            <BriefGenerator missed={missed} meetings={completed ?? []} initialMeeting={meeting} selfId={ctx.user.id} canAdd={can(ctx.role, 'task.create')} />
          ) : (
            <Card><CardContent className="p-4 text-sm text-muted-foreground">Viewers can read meetings but cannot generate AI briefs.</CardContent></Card>
          )}
          <Card>
            <CardHeader><CardTitle>Your previous summaries</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {(past ?? []).length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
              {(past ?? []).map((g) => (
                <details key={g.id} className="group rounded-md border p-3">
                  <summary className="cursor-pointer list-none text-sm font-medium">
                    {(g.parsed_output as CatchUpBrief | null)?.headline ?? 'Brief'}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">{titles.get(g.target_id ?? '') ?? 'meeting'} · {relTime(g.created_at)}</span>
                  </summary>
                  <div className="mt-3 border-t pt-3">{g.parsed_output ? <CatchUpView brief={g.parsed_output as CatchUpBrief} meetingId={g.target_id ?? ''} selfId={ctx.user.id} canAdd={can(ctx.role, 'task.create') && !!g.target_id} /> : null}</div>
                </details>
              ))}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-1.5"><Sparkles className="size-4 text-indigo-500" /> Meetings you missed</CardTitle></CardHeader>
            <CardContent>
              {missed.length === 0 ? <p className="text-xs text-muted-foreground">You attended every meeting you were invited to.</p> : (
                <ul className="space-y-1.5">
                  {missed.map((m) => (
                    <li key={m.id}><Link href={`/briefs?meeting=${m.id}`} className="text-sm hover:underline">{m.title}</Link><span className="block text-xs text-muted-foreground">{fmtDate(m.scheduled_at)}</span></li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-1.5"><Repeat2 className="size-4 text-amber-500" /> Handover briefs for you</CardTitle></CardHeader>
            <CardContent>
              {(received ?? []).length === 0 ? <Empty title="No handovers received" /> : (
                <ul className="space-y-1.5">
                  {((received ?? []) as unknown as { id: string; completed_at: string | null; outgoing: { full_name: string } | null; handover_items: { id: string }[] }[]).map((h) => (
                    <li key={h.id}><Link href={`/handovers/${h.id}`} className="text-sm hover:underline">From {h.outgoing?.full_name} · {h.handover_items.length} task(s)</Link><span className="block text-xs text-muted-foreground">{fmtDate(h.completed_at)}</span></li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
