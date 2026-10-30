import { route, check, notFound, ApiError } from '@/lib/api';
import { generateJSON } from '@/lib/ai/groq';
import { TaskBriefZ, taskBriefPrompt } from '@/lib/ai/prompts';
import { gatherHandoverContext } from '@/lib/handover-context';

export const maxDuration = 60;

/** AI brief for a single task: origin, decisions, history, documents → plain-language summary + next steps. */
export const POST = route({ permission: 'brief.generate' }, async ({ ctx, params, log }) => {
  const task = check(
    await ctx.supabase.from('action_items').select('id,assignee_id,assignee:profiles!action_items_assignee_id_fkey(full_name)').eq('id', params.id).eq('workspace_id', ctx.workspace.id).maybeSingle(),
    'loading task',
  );
  if (!task) throw notFound('Task');

  const context = await gatherHandoverContext(ctx, task.assignee_id ?? ctx.user.id, ctx.user.id, [task.id]);
  const t = context.tasks[0];
  if (!t) throw notFound('Task');

  const { data: actors } = await ctx.supabase.from('task_events').select('event_type,notes,created_at,actor:profiles(full_name)').eq('task_id', task.id).order('created_at');
  const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  const prompt = taskBriefPrompt({
    reader: ctx.profile.full_name,
    today: fmt(new Date().toISOString()),
    task: {
      title: t.title,
      description: t.description,
      status: t.status.replace('_', ' '),
      priority: t.priority,
      due: t.due ? fmt(t.due) : null,
      owner: (task.assignee as unknown as { full_name: string } | null)?.full_name ?? 'nobody (unassigned)',
      source_meeting: t.source_meeting ? { ...t.source_meeting, date: fmt(t.source_meeting.date) } : null,
      decisions: t.decisions,
      history: ((actors ?? []) as unknown as { event_type: string; notes: string | null; created_at: string; actor: { full_name: string } | null }[]).map((e) => ({
        what: e.event_type.replace('_', ' '),
        by: e.actor?.full_name ?? null,
        note: e.notes?.startsWith('Handover ') ? null : e.notes,
        on: fmt(e.created_at),
      })),
      documents: t.documents,
    },
  });

  const result = await generateJSON({ ctx, type: 'catch_up_brief', schema: TaskBriefZ, system: prompt.system, user: prompt.user, target: { type: 'action_item', id: task.id }, log, temperature: 0.3 });
  if (!result.ok) throw new ApiError(502, result.error);

  const clean = (s: string) => s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, 'this task').replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_m, y, mo, d) => fmt(`${y}-${mo}-${d}T12:00:00Z`));
  const brief = {
    summary: clean(result.data.summary),
    where_it_stands: clean(result.data.where_it_stands),
    next_steps: result.data.next_steps.slice(0, 4).map((s) => clean(s).replace(/\.$/, '')),
    risks: result.data.risks.slice(0, 3).map(clean),
    open_questions: result.data.open_questions.slice(0, 3).map(clean),
  };
  if (result.generationId) await ctx.supabase.from('ai_generations').update({ parsed_output: brief }).eq('id', result.generationId);
  return { brief, generatedAt: new Date().toISOString() };
});
