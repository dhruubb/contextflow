import { route, check, notFound, ApiError } from '@/lib/api';
import { generateJSON } from '@/lib/ai/groq';
import { MeetingExtractionZ, meetingExtractionPrompt } from '@/lib/ai/prompts';

/**
 * Runs Groq extraction on the meeting's raw notes and returns SUGGESTIONS only.
 * Nothing is persisted to tasks/decisions until a lead approves them via /apply.
 */
export const POST = route({ permission: 'meeting.ai_extract' }, async ({ ctx, params, log }) => {
  const meeting = check(
    await ctx.supabase.from('meetings').select('id,title,agenda,raw_notes,scheduled_at').eq('id', params.id).eq('workspace_id', ctx.workspace.id).maybeSingle(),
    'loading meeting',
  );
  if (!meeting) throw notFound('Meeting');
  if (!meeting.raw_notes || meeting.raw_notes.trim().length < 20) throw new ApiError(400, 'Add at least a few lines of notes before running AI extraction');

  const [{ data: members }, { data: participants }] = await Promise.all([
    ctx.supabase.from('workspace_members').select('user_id, role, profile:profiles(full_name)').eq('workspace_id', ctx.workspace.id),
    ctx.supabase.from('meeting_participants').select('attended, profile:profiles(full_name)').eq('meeting_id', meeting.id),
  ]);
  const roster = ((members ?? []) as unknown as { user_id: string; role: string; profile: { full_name: string } | null }[])
    .filter((m) => m.role !== 'viewer')
    .map((m) => ({ id: m.user_id, name: m.profile?.full_name ?? 'Unknown', role: m.role }));

  const prompt = meetingExtractionPrompt({
    title: meeting.title,
    date: meeting.scheduled_at.slice(0, 10),
    agenda: meeting.agenda,
    notes: meeting.raw_notes,
    members: roster,
    participants: ((participants ?? []) as unknown as { attended: boolean; profile: { full_name: string } | null }[]).map((p) => ({
      name: p.profile?.full_name ?? 'Unknown',
      attended: p.attended,
    })),
  });

  const result = await generateJSON({
    ctx,
    type: 'action_items_extract',
    schema: MeetingExtractionZ,
    system: prompt.system,
    user: prompt.user,
    target: { type: 'meeting', id: meeting.id },
    log,
  });
  if (!result.ok) throw new ApiError(502, result.error);

  // Resolve owners strictly against real workspace users; never accept invented ids.
  const byId = new Map(roster.map((m) => [m.id, m]));
  const byName = (name: string | null) => {
    if (!name) return null;
    const n = name.toLowerCase().trim();
    const hits = roster.filter((m) => m.name.toLowerCase() === n || m.name.toLowerCase().split(' ')[0] === n.split(' ')[0]);
    return hits.length === 1 ? hits[0] : null;
  };
  const validDate = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d)) ? d : null);

  const actionItems = result.data.action_items.map((a) => {
    const owner = (a.owner_id && byId.get(a.owner_id)) || byName(a.owner_name);
    return { ...a, owner_id: owner?.id ?? null, owner_resolved_name: owner?.name ?? null, deadline: validDate(a.deadline) };
  });

  log.info({ meetingId: meeting.id, decisions: result.data.decisions.length, actionItems: actionItems.length, latencyMs: result.latencyMs }, 'meeting extraction ready for review');
  return {
    generationId: result.generationId,
    model: result.model,
    latencyMs: result.latencyMs,
    summary: result.data.summary,
    decisions: result.data.decisions,
    action_items: actionItems,
    open_questions: result.data.open_questions,
  };
});
