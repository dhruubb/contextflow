'use client';
import { useState } from 'react';
import { AlertTriangle, HelpCircle, RefreshCw, Sparkles } from 'lucide-react';
import type { TaskBrief } from '@/lib/ai/prompts';
import { api } from '@/lib/client-api';
import { Button, Card, Skeleton } from '@/components/ui';
import { NextSteps } from '@/components/next-steps';
import { relTime } from '@/lib/utils';

export function TaskBriefCard({
  taskId,
  taskTitle,
  initial,
  canGenerate,
  canAdd,
  selfId,
  meetingId,
}: {
  taskId: string;
  taskTitle: string;
  initial: { brief: TaskBrief; generatedAt: string } | null;
  canGenerate: boolean;
  canAdd: boolean;
  selfId: string;
  meetingId: string | null;
}) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      setData(await api<{ brief: TaskBrief; generatedAt: string }>(`/api/tasks/${taskId}/brief`, { method: 'POST' }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-indigo-500/25">
      <div className="flex items-center justify-between gap-3 border-b px-5 py-3.5">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="size-4 text-indigo-500" /> AI brief</h2>
          {data && <p className="text-[11px] text-muted-foreground">Generated {relTime(data.generatedAt)}</p>}
        </div>
        {data && canGenerate && (
          <Button size="sm" variant="ghost" onClick={generate} loading={loading}><RefreshCw /> Refresh</Button>
        )}
      </div>

      <div className="p-5">
        {!data && !loading && (
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <p className="flex-1 text-sm text-muted-foreground">Get a 30-second summary of this task: where it came from, where it stands, and what to do next.</p>
            {canGenerate ? (
              <Button variant="secondary" onClick={generate}><Sparkles /> Brief me on this task</Button>
            ) : (
              <span className="text-xs text-muted-foreground">Viewers can’t generate briefs.</span>
            )}
          </div>
        )}

        {loading && !data && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Reading the meeting, decisions and history…</p>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        )}

        {error && <p className="mt-2 rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

        {data && (
          <div className={`animate-in space-y-5 ${loading ? 'opacity-50' : ''}`}>
            <div className="space-y-2 text-sm leading-relaxed">
              <p>{data.brief.summary}</p>
              <p className="text-muted-foreground">{data.brief.where_it_stands}</p>
            </div>

            {data.brief.next_steps.length > 0 && (
              <NextSteps steps={data.brief.next_steps} meetingId={meetingId} selfId={selfId} canAdd={canAdd} source={`the AI brief for “${taskTitle}”`} />
            )}

            {(data.brief.risks.length > 0 || data.brief.open_questions.length > 0) && (
              <div className="grid gap-4 sm:grid-cols-2">
                {data.brief.risks.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Risks</p>
                    <ul className="space-y-1 text-sm">
                      {data.brief.risks.map((r, i) => <li key={i} className="flex gap-2"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />{r}</li>)}
                    </ul>
                  </div>
                )}
                {data.brief.open_questions.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Open questions</p>
                    <ul className="space-y-1 text-sm">
                      {data.brief.open_questions.map((q, i) => <li key={i} className="flex gap-2"><HelpCircle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />{q}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
