'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import type { CatchUpBrief } from '@/lib/ai/prompts';
import { api } from '@/lib/client-api';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Select } from '@/components/ui';
import { CatchUpView } from '@/components/catchup-brief';
import { fmtDate } from '@/lib/utils';

export function BriefGenerator({ missed, meetings, initialMeeting, selfId, canAdd }: { missed: { id: string; title: string }[]; meetings: { id: string; title: string; scheduled_at: string }[]; initialMeeting?: string; selfId: string; canAdd: boolean }) {
  const router = useRouter();
  const [meetingId, setMeetingId] = useState(initialMeeting ?? missed[0]?.id ?? meetings[0]?.id ?? '');
  const [brief, setBrief] = useState<CatchUpBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missedIds = new Set(missed.map((m) => m.id));

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ brief: CatchUpBrief }>('/api/briefs/catch-up', { body: { meeting_id: meetingId } });
      setBrief(r.brief);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-indigo-500/30">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-1.5"><Sparkles className="size-4 text-indigo-500" /> Catch up on a meeting</CardTitle>
          <CardDescription>Pick a meeting to get a short summary of what you missed and what to do next.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2">
          <Select value={meetingId} onChange={(e) => { setMeetingId(e.target.value); setBrief(null); }}>
            {meetings.length === 0 && <option value="">No completed meetings</option>}
            {meetings.map((m) => (
              <option key={m.id} value={m.id}>{missedIds.has(m.id) ? '● ' : ''}{m.title} · {fmtDate(m.scheduled_at)}</option>
            ))}
          </Select>
          <Button variant="secondary" onClick={generate} loading={loading} disabled={!meetingId}>Get summary</Button>
        </div>
        {missed.length > 0 && <p className="mt-1 text-[11px] text-muted-foreground">● = you missed this meeting</p>}
        {error && <p className="mt-3 rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
        {loading && <p className="mt-4 animate-pulse text-sm text-muted-foreground">Reading notes, decisions and task history…</p>}
        {brief && <div className="animate-in mt-4 border-t pt-4"><CatchUpView brief={brief} meetingId={meetingId} selfId={selfId} canAdd={canAdd} /></div>}
      </CardContent>
    </Card>
  );
}
