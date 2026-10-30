import Link from 'next/link';
import { AlertTriangle, ArrowRight, CircleDot, HelpCircle } from 'lucide-react';
import type { HandoverContext } from '@/lib/ai/prompts';

export function parseHandover(s: string | null | undefined): HandoverContext | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as HandoverContext;
  } catch {
    return { overview: s, tasks: [], open_questions: [] };
  }
}

/** Structured handover brief: overview, then one compact block per task. */
export function HandoverBrief({ brief, titles }: { brief: HandoverContext; titles: Record<string, string> }) {
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed">{brief.overview}</p>

      {brief.tasks.map((t) => (
        <div key={t.task_id} className="overflow-hidden rounded-lg border">
          <Link href={`/tasks/${t.task_id}`} className="flex items-center gap-2 border-b bg-muted/30 px-3.5 py-2.5 text-sm font-medium hover:underline">
            <CircleDot className="size-4 text-primary" /> {titles[t.task_id] ?? 'Task'}
          </Link>
          <div className="space-y-3 px-3.5 py-3 text-sm">
            <p className="text-muted-foreground">{t.context}</p>
            {t.current_state && (
              <p className="flex gap-2"><span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Now</span>{t.current_state}</p>
            )}
            {t.next_steps.length > 0 && (
              <ul className="space-y-1">
                {t.next_steps.map((s, i) => (
                  <li key={i} className="flex gap-2"><ArrowRight className="mt-0.5 size-3.5 shrink-0 text-primary" />{s}</li>
                ))}
              </ul>
            )}
            {t.risks.length > 0 && (
              <ul className="space-y-1">
                {t.risks.map((s, i) => (
                  <li key={i} className="flex gap-2 text-amber-700 dark:text-amber-300"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{s}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ))}

      {brief.open_questions.length > 0 && (
        <ul className="space-y-1 text-sm">
          {brief.open_questions.map((q, i) => (
            <li key={i} className="flex gap-2 text-muted-foreground"><HelpCircle className="mt-0.5 size-3.5 shrink-0" />{q}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
