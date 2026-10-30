import { z } from 'zod';
import { route, check, notFound, ApiError, zId } from '@/lib/api';
import { generateJSON } from '@/lib/ai/groq';
import { CatchUpZ, catchUpPrompt } from '@/lib/ai/prompts';
import { logActivity } from '@/lib/activity';

const BriefZ = z.object({ meeting_id: zId });

/** Personalized catch-up brief for the signed-in user about a meeting (typically one they missed). */
export const POST = route({ body: BriefZ, permission: 'brief.generate' }, async ({ ctx, body, log }) => {
  const meeting = check(
    await ctx.supabase.from('meetings').select('id,title,agenda,raw_notes,summary,scheduled_at,status').eq('id', body.meeting_id).eq('workspace_id', ctx.workspace.id).maybeSingle(),
    'loading meeting',
  );
  if (!meeting) throw notFound('Meeting');
  if (!meeting.raw_notes && !meeting.summary) throw new ApiError(400, 'This meeting has no notes or summary yet');

  const [{ data: decisions }, { data: links }, { data: participants }] = await Promise.all([
    ctx.supabase.from('decisions').select('id,title,description,rationale').eq('meeting_id', meeting.id),
    ctx.supabase
      .from('meeting_action_items')
      .select('is_carried_forward, task:action_items(id,title,status,priority,due_date,assignee_id,outcome_notes,assignee:profiles!action_items_assignee_id_fkey(full_name))')
      .eq('meeting_id', meeting.id),
    ctx.supabase.from('meeting_participants').select('user_id,attended,profile:profiles(full_name)').eq('meeting_id', meeting.id),
  ]);
  type T = { id: string; title: string; status: string; priority: string; due_date: string | null; assignee_id: string | null; outcome_notes: string | null; assignee: { full_name: string } | null };
  const tasks = ((links ?? []) as unknown as { is_carried_forward: boolean; task: T | null }[]).filter((l) => l.task).map((l) => ({ ...l.task!, carried_forward: l.is_carried_forward }));
  const taskIds = tasks.map((t) => t.id);

  const [{ data: changes }, { data: docLinks }] = await Promise.all([
    taskIds.length
      ? ctx.supabase.from('task_events').select('task_id,event_type,previous_value,new_value,notes,created_at').in('task_id', taskIds).gt('created_at', meeting.scheduled_at).order('created_at')
      : Promise.resolve({ data: [] as { task_id: string; event_type: string; previous_value: string | null; new_value: string | null; notes: string | null; created_at: string }[] }),
    ctx.supabase
      .from('knowledge_links')
      .select('target_id, document:knowledge_documents(id,title)')
      .in('target_id', [meeting.id, ...taskIds]),
  ]);
  const documents = Array.from(
    new Map(((docLinks ?? []) as unknown as { document: { id: string; title: string } | null }[]).filter((d) => d.document).map((d) => [d.document!.id, d.document!])).values(),
  );
  const me = ((participants ?? []) as unknown as { user_id: string; attended: boolean }[]).find((p) => p.user_id === ctx.user.id);

  const prompt = catchUpPrompt({
    reader: { name: ctx.profile.full_name, attended_this_meeting: me?.attended ?? false, was_invited: !!me },
    meeting: { id: meeting.id, title: meeting.title, date: meeting.scheduled_at.slice(0, 10), agenda: meeting.agenda, summary: meeting.summary, raw_notes: meeting.raw_notes?.slice(0, 12_000) },
    attendance: ((participants ?? []) as unknown as { attended: boolean; profile: { full_name: string } | null }[]).map((p) => ({ name: p.profile?.full_name, attended: p.attended })),
    decisions,
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, due: t.due_date?.slice(0, 10) ?? null, owner: t.assignee?.full_name ?? null, is_reader: t.assignee_id === ctx.user.id, carried_forward: t.carried_forward, outcome: t.outcome_notes })),
    changes_since_meeting: (changes ?? []).map((c) => ({ task_id: c.task_id, event: c.event_type, from: c.previous_value, to: c.new_value, notes: c.notes, at: c.created_at.slice(0, 10) })),
    documents,
  });

  const result = await generateJSON({ ctx, type: 'catch_up_brief', schema: CatchUpZ, system: prompt.system, user: prompt.user, target: { type: 'meeting', id: meeting.id }, log, temperature: 0.3 });
  if (!result.ok) throw new ApiError(502, result.error);

  // Drop any references the model invented.
  const valid = new Set([meeting.id, ...taskIds, ...documents.map((d) => d.id)]);
  const brief = {
    ...result.data,
    references: result.data.references.filter((r) => valid.has(r.id)),
    your_action_items: result.data.your_action_items.map((a) => ({ ...a, task_id: a.task_id && valid.has(a.task_id) ? a.task_id : null })),
  };
  if (result.generationId) await ctx.supabase.from('ai_generations').update({ parsed_output: brief }).eq('id', result.generationId);

  await logActivity(ctx, 'brief.generated', 'meeting', meeting.id, { title: meeting.title }, log);
  return { brief, generationId: result.generationId, meeting: { id: meeting.id, title: meeting.title } };
});
