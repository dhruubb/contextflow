import { z } from 'zod';
import { route, check, notFound, zId } from '@/lib/api';
import { createTask, TaskPriorityZ } from '@/lib/tasks';
import { logActivity } from '@/lib/activity';

/** Persists the human-reviewed AI suggestions (summary, decisions, tasks). Duplicate-safe. */
const ApplyZ = z.object({
  summary: z.string().trim().max(10_000).nullish(),
  decisions: z.array(z.object({ title: z.string().trim().min(3).max(300), description: z.string().max(4000).nullish(), rationale: z.string().max(4000).nullish() })).max(30).default([]),
  action_items: z
    .array(
      z.object({
        title: z.string().trim().min(2).max(200),
        description: z.string().max(4000).nullish(),
        assignee_id: zId.nullish(),
        due_date: z.string().nullish(),
        priority: TaskPriorityZ.default('medium'),
      }),
    )
    .max(50)
    .default([]),
  mark_completed: z.boolean().default(true),
});

export const POST = route({ body: ApplyZ, permission: 'meeting.ai_apply' }, async ({ ctx, body, params, log }) => {
  const meeting = check(
    await ctx.supabase.from('meetings').select('id,title,status').eq('id', params.id).eq('workspace_id', ctx.workspace.id).maybeSingle(),
    'loading meeting',
  );
  if (!meeting) throw notFound('Meeting');

  const update: Record<string, unknown> = {};
  if (body.summary) update.summary = body.summary;
  if (body.mark_completed && meeting.status !== 'completed') {
    update.status = 'completed';
    update.ended_at = new Date().toISOString();
  }
  if (Object.keys(update).length) check(await ctx.supabase.from('meetings').update(update).eq('id', meeting.id), 'saving summary');

  // Decisions: skip ones that already exist for this meeting (case-insensitive)
  const { data: existingDecisions } = await ctx.supabase.from('decisions').select('title').eq('meeting_id', meeting.id);
  const seenD = new Set((existingDecisions ?? []).map((d) => d.title.toLowerCase()));
  const newDecisions = body.decisions.filter((d) => !seenD.has(d.title.toLowerCase()) && seenD.add(d.title.toLowerCase()));
  if (newDecisions.length) {
    check(
      await ctx.supabase.from('decisions').insert(
        newDecisions.map((d) => ({
          workspace_id: ctx.workspace.id, meeting_id: meeting.id, title: d.title, description: d.description ?? null,
          rationale: d.rationale ?? null, decided_by: ctx.user.id, ai_generated: true,
        })),
      ),
      'saving decisions',
    );
  }

  // Tasks: skip duplicates by title within this meeting
  const { data: existingTasks } = await ctx.supabase.from('action_items').select('title').eq('source_meeting_id', meeting.id);
  const seenT = new Set((existingTasks ?? []).map((t) => t.title.toLowerCase()));
  const created = [];
  let skipped = 0;
  for (const a of body.action_items) {
    if (seenT.has(a.title.toLowerCase())) {
      skipped++;
      continue;
    }
    seenT.add(a.title.toLowerCase());
    created.push(await createTask(ctx, { ...a, source_meeting_id: meeting.id, ai_generated: true }, log));
  }

  await logActivity(ctx, 'meeting.ai_applied', 'meeting', meeting.id, { title: meeting.title, decisions: newDecisions.length, tasks: created.length }, log);
  log.info({ meetingId: meeting.id, decisions: newDecisions.length, tasks: created.length, skippedDuplicates: skipped }, 'ai suggestions approved');
  return { decisions: newDecisions.length, tasks: created.length, skippedDuplicates: skipped };
});
