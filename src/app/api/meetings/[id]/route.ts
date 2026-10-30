import { z } from 'zod';
import { route, check, ApiError, notFound, forbidden, zId } from '@/lib/api';
import { can } from '@/lib/rbac';
import { logActivity } from '@/lib/activity';
import { notify } from '@/lib/notify';

const UpdateMeetingZ = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  agenda: z.string().trim().max(5000).nullish(),
  raw_notes: z.string().max(50_000).nullish(),
  summary: z.string().max(10_000).nullish(),
  status: z.enum(['scheduled', 'in_progress', 'completed', 'cancelled']).optional(),
  scheduled_at: z.string().refine((v) => !isNaN(Date.parse(v)), 'Invalid date').optional(),
  participants: z.array(z.object({ user_id: zId, attended: z.boolean() })).max(50).optional(),
});

export const PATCH = route({ body: UpdateMeetingZ, permission: 'meeting.notes' }, async ({ ctx, body, params, log }) => {
  const meeting = check(
    await ctx.supabase.from('meetings').select('*').eq('id', params.id).eq('workspace_id', ctx.workspace.id).maybeSingle(),
    'loading meeting',
  );
  if (!meeting) throw notFound('Meeting');

  const isEditor = can(ctx.role, 'meeting.edit');
  const notesOnly = Object.keys(body).every((k) => k === 'raw_notes');
  if (!isEditor && !notesOnly) throw forbidden('Members can only edit meeting notes');

  const update: Record<string, unknown> = {};
  for (const k of ['title', 'agenda', 'raw_notes', 'summary', 'status'] as const) if (body[k] !== undefined) update[k] = body[k];
  if (body.scheduled_at) update.scheduled_at = new Date(body.scheduled_at).toISOString();
  if (body.status === 'completed' && meeting.status !== 'completed') update.ended_at = new Date().toISOString();

  let updated = meeting;
  if (Object.keys(update).length) {
    updated = check(await ctx.supabase.from('meetings').update(update).eq('id', meeting.id).select('*').single(), 'updating meeting');
  }

  let added: string[] = [];
  if (body.participants && isEditor) {
    const { data: members } = await ctx.supabase.from('workspace_members').select('user_id').eq('workspace_id', ctx.workspace.id);
    const memberIds = new Set((members ?? []).map((m) => m.user_id));
    if (body.participants.some((p) => !memberIds.has(p.user_id))) throw new ApiError(400, 'Participants must be workspace members');
    const keep = body.participants.map((p) => p.user_id);
    const { data: existing } = await ctx.supabase.from('meeting_participants').select('user_id').eq('meeting_id', meeting.id);
    added = keep.filter((u) => !(existing ?? []).some((e) => e.user_id === u));
    const toRemove = (existing ?? []).map((e) => e.user_id).filter((u) => !keep.includes(u));
    if (toRemove.length) check(await ctx.supabase.from('meeting_participants').delete().eq('meeting_id', meeting.id).in('user_id', toRemove), 'removing participants');
    if (body.participants.length) {
      check(
        await ctx.supabase.from('meeting_participants').upsert(
          body.participants.map((p) => ({ meeting_id: meeting.id, user_id: p.user_id, attended: p.attended })),
          { onConflict: 'meeting_id,user_id' },
        ),
        'saving attendance',
      );
    }
  }

  // Notify newly invited people, and everyone when an upcoming meeting is rescheduled.
  const when = new Date(updated.scheduled_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
  if (updated.status === 'scheduled') {
    for (const uid of added) {
      await notify({ workspaceId: ctx.workspace.id, userId: uid, actorId: ctx.user.id, event: 'meeting_scheduled', title: 'You were added to a meeting', message: `${ctx.profile.full_name} added you to "${updated.title}" on ${when} IST.`, targetType: 'meeting', targetId: meeting.id, linkPath: `/meetings/${meeting.id}`, dedupeKey: `meeting:${meeting.id}:${uid}` }, log);
    }
    if (update.scheduled_at && update.scheduled_at !== new Date(meeting.scheduled_at).toISOString()) {
      const { data: parts } = await ctx.supabase.from('meeting_participants').select('user_id').eq('meeting_id', meeting.id);
      for (const p of parts ?? []) {
        await notify({ workspaceId: ctx.workspace.id, userId: p.user_id, actorId: ctx.user.id, event: 'meeting_rescheduled', title: 'Meeting rescheduled', message: `"${updated.title}" moved to ${when} IST.`, targetType: 'meeting', targetId: meeting.id, linkPath: `/meetings/${meeting.id}`, dedupeKey: `resched:${meeting.id}:${p.user_id}:${update.scheduled_at}` }, log);
      }
    }
  }

  await logActivity(ctx, update.status === 'completed' ? 'meeting.completed' : 'meeting.updated', 'meeting', meeting.id, { title: updated.title, fields: Object.keys(body) }, log);
  log.info({ meetingId: meeting.id, fields: Object.keys(body) }, 'meeting updated');
  return { meeting: updated };
});
