import Link from 'next/link';
import type { CatchUpBrief } from '@/lib/ai/prompts';
import { NextSteps } from '@/components/next-steps';
import { fmtDate } from '@/lib/utils';

const UUID = /\b(?:task\s+)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** Older briefs may contain raw ids / ISO dates — tidy them for display. */
const tidy = (s: string) =>
  s.replace(UUID, 'a task').replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_m, y, mo, d) => fmtDate(`${y}-${mo}-${d}T12:00:00Z`).replace(/ \d{4}$/, '')).replace(/^a task/, 'A task');

function Label({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</p>;
}

/** Clean, scannable catch-up brief. Next steps can be added to the reader's task list. */
export function CatchUpView({ brief: raw, meetingId, selfId, canAdd = false }: { brief: CatchUpBrief; meetingId: string; selfId?: string; canAdd?: boolean }) {
  const brief = { ...raw, summary: tidy(raw.summary), changes: raw.changes.map(tidy), suggested_next_steps: raw.suggested_next_steps.map(tidy) };
  const docs = brief.references.filter((r) => r.type === 'document');
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold leading-snug">{brief.headline}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{brief.summary}</p>
      </div>

      {brief.your_action_items.length > 0 && (
        <div>
          <Label>Your tasks from this meeting</Label>
          <ul className="divide-y rounded-md border">
            {brief.your_action_items.map((a, i) => (
              <li key={i} className="px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  {a.task_id ? <Link href={`/tasks/${a.task_id}`} className="text-sm font-medium hover:underline">{a.title}</Link> : <span className="text-sm font-medium">{a.title}</span>}
                  {a.deadline && <span className="shrink-0 text-xs text-muted-foreground">Due {fmtDate(a.deadline)}</span>}
                </div>
                {a.note && <p className="mt-0.5 text-xs text-muted-foreground">{a.note}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {brief.key_decisions.length > 0 && (
        <div>
          <Label>Decisions made</Label>
          <ul className="space-y-1.5">
            {brief.key_decisions.map((d, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-indigo-500" />
                <span>
                  {d.title}
                  {d.why_it_matters && <span className="block text-xs text-muted-foreground">{d.why_it_matters}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {brief.changes.length > 0 && (
        <div>
          <Label>What changed since</Label>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {brief.changes.map((c, i) => <li key={i} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/60" />{c}</li>)}
          </ul>
        </div>
      )}

      {brief.suggested_next_steps.length > 0 && <NextSteps steps={brief.suggested_next_steps} meetingId={meetingId} selfId={selfId} canAdd={canAdd} />}

      <p className="border-t pt-3 text-xs text-muted-foreground">
        Based on <Link href={`/meetings/${meetingId}`} className="underline underline-offset-2 hover:text-foreground">the meeting notes</Link>
        {docs.length > 0 && <> and {docs.map((d, i) => <span key={d.id}>{i > 0 && ', '}<Link href={`/knowledge/${d.id}`} className="underline underline-offset-2 hover:text-foreground">{d.title}</Link></span>)}</>}
        .
      </p>
    </div>
  );
}
