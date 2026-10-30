import Link from 'next/link';
import type { HandoverContext } from '@/lib/ai/prompts';

export function parseHandover(s: string | null | undefined): HandoverContext | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as HandoverContext;
  } catch {
    return { overview: s, tasks: [], open_questions: [] };
  }
}

export function HandoverBrief({ brief, titles }: { brief: HandoverContext; titles: Record<string, string> }) {
  return (
    <div className="space-y-4 text-sm">
      <p className="leading-relaxed">{brief.overview}</p>
      {brief.tasks.map((t) => (
        <div key={t.task_id} className="rounded-md border p-3">
          <Link href={`/tasks/${t.task_id}`} className="font-medium hover:underline">{titles[t.task_id] ?? 'Task'}</Link>
          <p className="mt-1 text-xs text-muted-foreground">{t.context}</p>
          {t.current_state && <p className="mt-1.5 text-xs"><span className="font-medium">Current state: </span>{t.current_state}</p>}
          {t.next_steps.length > 0 && (
            <div className="mt-1.5 text-xs">
              <span className="font-medium">Next steps</span>
              <ul className="list-disc pl-4">{t.next_steps.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
          )}
          {t.risks.length > 0 && (
            <div className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">
              <span className="font-medium">Risks</span>
              <ul className="list-disc pl-4">{t.risks.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
          )}
        </div>
      ))}
      {brief.open_questions.length > 0 && (
        <div className="text-xs">
          <p className="font-medium">Open questions</p>
          <ul className="list-disc pl-4 text-muted-foreground">{brief.open_questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
