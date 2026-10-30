import { route, ApiError } from '@/lib/api';
import { computeHealth } from '@/lib/continuity';
import { generateJSON } from '@/lib/ai/groq';
import { ContinuityZ, continuityPrompt } from '@/lib/ai/prompts';

/** Deterministic Context Health Score + Groq risk explanation and next-meeting recommendations. */
export const POST = route({ permission: 'continuity.analyze' }, async ({ ctx, log }) => {
  const report = await computeHealth(ctx.supabase, ctx.workspace.id);
  const prompt = continuityPrompt({
    score: report.score,
    status: report.status,
    components: report.components.filter((c) => c.count > 0),
    next_meeting: report.nextMeeting,
    at_risk_tasks: report.riskTasks.slice(0, 20).map((t) => ({
      task_id: t.id, title: t.title, status: t.status, priority: t.priority, due: t.due_date?.slice(0, 10) ?? null,
      owner: t.assignee_name, source_meeting: t.source_meeting_title, carried_forward_times: t.carry_count, signals: t.signals,
    })),
  });
  const result = await generateJSON({ ctx, type: 'continuity_risk', schema: ContinuityZ, system: prompt.system, user: prompt.user, target: { type: 'workspace', id: ctx.workspace.id }, log });
  if (!result.ok) throw new ApiError(502, result.error);

  const valid = new Set(report.riskTasks.map((t) => t.id));
  const analysis = {
    ...result.data,
    risks: result.data.risks.map((r) => ({ ...r, task_id: r.task_id && valid.has(r.task_id) ? r.task_id : null })),
    agenda_suggestions: result.data.agenda_suggestions.filter((a) => valid.has(a.task_id)),
  };
  if (result.generationId) await ctx.supabase.from('ai_generations').update({ parsed_output: { ...analysis, score: report.score } }).eq('id', result.generationId);
  log.info({ score: report.score, risks: analysis.risks.length }, 'continuity analysis');
  return { score: report.score, analysis };
});
