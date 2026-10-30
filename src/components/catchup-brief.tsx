import Link from 'next/link';
import type { CatchUpBrief } from '@/lib/ai/prompts';
import { Badge } from '@/components/ui';
import { fmtDate } from '@/lib/utils';

export function CatchUpView({ brief }: { brief: CatchUpBrief }) {
  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="text-base font-semibold">{brief.headline}</p>
        <p className="mt-1 leading-relaxed text-muted-foreground">{brief.summary}</p>
      </div>
      {brief.your_action_items.length > 0 && (
        <section>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your action items</p>
          <ul className="space-y-1.5">
            {brief.your_action_items.map((a, i) => (
              <li key={i} className="rounded-md border p-2">
                {a.task_id ? <Link href={`/tasks/${a.task_id}`} className="font-medium hover:underline">{a.title}</Link> : <span className="font-medium">{a.title}</span>}
                {a.deadline && <Badge tone="amber" className="ml-2">due {fmtDate(a.deadline)}</Badge>}
                {a.note && <p className="text-xs text-muted-foreground">{a.note}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {brief.key_decisions.length > 0 && (
        <section>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Key decisions</p>
          <ul className="space-y-1">
            {brief.key_decisions.map((d, i) => (
              <li key={i}>
                <span className="font-medium">{d.title}</span>
                {d.why_it_matters && <span className="text-muted-foreground"> — {d.why_it_matters}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {brief.changes.length > 0 && (
        <section>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">What changed since</p>
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">{brief.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </section>
      )}
      {brief.suggested_next_steps.length > 0 && (
        <section>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Suggested next steps</p>
          <ul className="list-disc space-y-0.5 pl-5">{brief.suggested_next_steps.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </section>
      )}
      {brief.references.length > 0 && (
        <section className="flex flex-wrap gap-1.5">
          {brief.references.map((r) => (
            <Link key={r.id} href={r.type === 'document' ? `/knowledge/${r.id}` : r.type === 'task' ? `/tasks/${r.id}` : `/meetings/${r.id}`}>
              <Badge tone="indigo" className="cursor-pointer">{r.type}: {r.title}</Badge>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
