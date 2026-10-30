import { z } from 'zod';
import { route, check, ApiError, zId } from '@/lib/api';
import { logActivity } from '@/lib/activity';
import { notify } from '@/lib/notify';

const CreateMeetingZ = z.object({
  title: z.string().trim().min(3).max(200),
  agenda: z.string().trim().max(5000).nullish(),
  scheduled_at: z.string().refine((v) => !isNaN(Date.parse(v)), 'Invalid date'),
  participant_ids: z.array(zId).max(50).default([]),
  carry_forward_task_ids: z.array(zId).max(50).default([]),
});

export const POST = route({ body: CreateMeetingZ, permission: 'meeting.create' }, async ({ ctx, body, log }) => {
  const { data: members } = await ctx.supabase.from('workspace_members').select('user_id').eq('workspace_id', ctx.workspace.id);
  const memberIds = new Set((members ?? []).map((m) => m.user_id));
  const invalid = body.participant_ids.filter((id) => !memberIds.has(id));
  if (invalid.length) throw new ApiError(400, 'Some participants are not workspace members');

  const meeting = check(
    await ctx.supabase
      .from('meetings')
      .insert({
        workspace_id: ctx.workspace.id,
        title: body.title,
        agenda: body.agenda ?? null,
        scheduled_at: new Date(body.scheduled_at).toISOString(),
        status: 'scheduled',
        created_by: ctx.user.id,
      })
      .select('*')
      .single(),
    'creating meeting',
  );

  const participants = Array.from(new Set([ctx.user.id, ...body.participant_ids]));
  check(
    await ctx.supabase.from('meeting_participants').insert(participants.map((user_id) => ({ meeting_id: meeting.id, user_id, attended: false }))),
    'adding participants',
  );

  if (body.carry_forward_task_ids.length) {
    const { carryForward } = await import('@/lib/tasks');
    await carryForward(ctx, meeting.id, body.carry_forward_task_ids, log);
  }

  await logActivity(ctx, 'meeting.created', 'meeting', meeting.id, { title: meeting.title, participants: participants.length }, log);
  log.info({ meetingId: meeting.id, participants: participants.length }, 'meeting created');

  const when = new Date(meeting.scheduled_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
  await Promise.all(
    participants.map((uid) =>
      notify(
        {
          workspaceId: ctx.workspace.id,
          userId: uid,
          actorId: ctx.user.id,
          event: 'meeting_scheduled',
          title: 'Meeting scheduled',
          message: `${ctx.profile.full_name} scheduled "${meeting.title}" for ${when} IST.`,
          targetType: 'meeting',
          targetId: meeting.id,
          linkPath: `/meetings/${meeting.id}`,
          dedupeKey: `meeting:${meeting.id}:${uid}`,
        },
        log,
      ),
    ),
  );
  return { meeting };
});
