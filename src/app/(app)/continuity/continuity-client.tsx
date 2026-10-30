'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import type { ContinuityAnalysis } from '@/lib/ai/prompts';
import { api } from '@/lib/client-api';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui';
import { CarryButton } from '@/components/task-actions';

export { CarryButton };

export function AiAnalysis({ canCarry, nextMeeting, titles }: { canCarry: boolean; nextMeeting: { id: string; title: string } | null; titles: Record<string, string> }) {
  const [data, setData] = useState<ContinuityAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      setData((await api<{ analysis: ContinuityAnalysis }>('/api/continuity/analyze', { method: 'POST' })).analysis);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  const tone = { high: 'red', medium: 'amber', low: 'neutral' } as const;

  return (
    <Card className="border-indigo-500/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5"><Sparkles className="size-4 text-indigo-500" /> AI risk briefing</CardTitle>
        {data && <Button size="sm" variant="ghost" onClick={run} loading={loading}>Refresh</Button>}
      </CardHeader>
      <CardContent>
        {!data && !loading && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Groq reads the risk signals and writes a plain-language briefing: what’s at risk, why, and who should do what. It never changes the score.</p>
            <Button variant="secondary" className="w-full" onClick={run}><Sparkles /> Generate briefing</Button>
          </div>
        )}
        {loading && (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}
        {error && <p className="mt-2 rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
        {data && !loading && (
          <div className="animate-in space-y-3">
            <p className="text-sm leading-relaxed">{data.narrative}</p>
            <ol className="space-y-2">
              {data.risks.map((r, i) => (
                <li key={i} className="rounded-md border p-2.5">
                  <div className="flex items-start gap-2">
                    <Badge tone={tone[r.severity]}>{r.severity}</Badge>
                    <p className="text-sm font-medium leading-tight">{r.task_id ? <Link href={`/tasks/${r.task_id}`} className="hover:underline">{r.title}</Link> : r.title}</p>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{r.explanation}</p>
                  <p className="mt-1.5 rounded bg-muted/60 px-2 py-1 text-xs"><span className="font-medium">Do: </span>{r.recommendation}</p>
                </li>
              ))}
            </ol>
            {data.agenda_suggestions.length > 0 && nextMeeting && (
              <div className="rounded-md border border-dashed p-2.5">
                <p className="text-xs font-medium">Suggested agenda for “{nextMeeting.title}”</p>
                <ul className="my-1.5 space-y-0.5 text-xs text-muted-foreground">
                  {data.agenda_suggestions.map((a) => <li key={a.task_id}>• {titles[a.task_id] ?? 'Task'} — {a.reason}</li>)}
                </ul>
                {canCarry && <CarryButton meetingId={nextMeeting.id} taskIds={data.agenda_suggestions.map((a) => a.task_id)} label="Add to agenda" />}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
