import 'server-only';
import { z } from 'zod';
import type { AppContext } from '@/lib/auth';
import type { Logger } from '@/lib/logger';
import { ApiError, check, dbError, forbidden, notFound, zId } from '@/lib/api';
import { can } from '@/lib/rbac';
import { logActivity } from '@/lib/activity';
import { notify } from '@/lib/notify';

export const TaskStatusZ = z.enum(['todo', 'in_progress', 'blocked', 'done']);
export const TaskPriorityZ = z.enum(['low', 'medium', 'high', 'urgent']);

export const CreateTaskZ = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(4000).nullish(),
  priority: TaskPriorityZ.default('medium'),
  assignee_id: zId.nullish(),
  due_date: z.string().nullish(),
  source_meeting_id: zId.nullish(),
});

export const UpdateTaskZ = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().max(4000).nullish(),
  status: TaskStatusZ.optional(),
  priority: TaskPriorityZ.optional(),
  assignee_id: zId.nullish(),
  due_date: z.string().nullish(),
  outcome_notes: z.string().trim().max(4000).nullish(),
  note: z.string().trim().max(1000).nullish(),
});

const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : 'none');

export function normalizeDue(d: string | null | undefined): string | null {
  if (!d) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T18:00:00+05:30`) : new Date(d);
  if (isNaN(date.getTime())) throw new ApiError(400, 'Invalid due date');
  return date.toISOString();
}

async function assertMember(ctx: AppContext, userId: string) {
  const { data } = await ctx.supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', ctx.workspace.id)
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) throw new ApiError(400, 'Assignee is not a member of this workspace');
  if (data.role === 'viewer') throw new ApiError(400, 'Viewers cannot own tasks');
}

async function event(ctx: AppContext, taskId: string, type: string, prev: string | null, next: string | null, notes: string | null, log: Logger) {
  const { error } = await ctx.supabase.from('task_events').insert({
    task_id: taskId,
    event_type: type,
    actor_id: ctx.user.id,
    previous_value: prev,
    new_value: next,
    notes,
  });
  if (error) log.warn({ error: error.message, type }, 'task event not recorded');
}

export async function createTask(
  ctx: AppContext,
  input: z.infer<typeof CreateTaskZ> & { ai_generated?: boolean },
  log: Logger,
) {
  if (input.assignee_id) await assertMember(ctx, input.assignee_id);
  const { data, error } = await ctx.supabase
    .from('action_items')
    .insert({
      workspace_id: ctx.workspace.id,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority,
      assignee_id: input.assignee_id ?? null,
      creator_id: ctx.user.id,
      source_meeting_id: input.source_meeting_id ?? null,
      due_date: normalizeDue(input.due_date),
      ai_generated: input.ai_generated ?? false,
    })
    .select('*')
    .single();
  const e = dbError(error, 'creating task');
  if (e) throw e;

  await event(ctx, data.id, 'created', null, 'todo', input.ai_generated ? 'Approved from AI meeting extraction' : null, log);
  if (input.source_meeting_id) {
    await ctx.supabase.from('meeting_action_items').upsert(
      { meeting_id: input.source_meeting_id, action_item_id: data.id, is_carried_forward: false },
      { onConflict: 'meeting_id,action_item_id' },
    );
  }
  await logActivity(ctx, 'task.created', 'action_item', data.id, { title: data.title, assignee_id: data.assignee_id }, log);
  log.info({ taskId: data.id, assigneeId: data.assignee_id, aiGenerated: !!input.ai_generated }, 'task created');

  if (data.assignee_id) {
    await notify(
      {
        workspaceId: ctx.workspace.id,
        userId: data.assignee_id,
        actorId: ctx.user.id,
        event: 'task_assigned',
        title: 'New task assigned to you',
        message: `${ctx.profile.full_name} assigned you "${data.title}"${data.due_date ? ` — due ${fmtDate(data.due_date)}` : ''}.`,
        targetType: 'action_item',
        targetId: data.id,
        linkPath: `/tasks/${data.id}`,
        dedupeKey: `assigned:${data.id}:${data.assignee_id}`,
      },
      log,
    );
  }
  return data;
}

export async function updateTask(ctx: AppContext, id: string, patch: z.infer<typeof UpdateTaskZ>, log: Logger) {
  const current = check(
    await ctx.supabase.from('action_items').select('*').eq('id', id).eq('workspace_id', ctx.workspace.id).maybeSingle(),
    'loading task',
  );
  if (!current) throw notFound('Task');

  const isLead = can(ctx.role, 'task.manage_any');
  const isOwner = current.assignee_id === ctx.user.id || current.creator_id === ctx.user.id;
  if (!isLead && !(can(ctx.role, 'task.update_own') && isOwner)) {
    throw forbidden('Only the task owner or a team lead can update this task');
  }
  if (patch.assignee_id !== undefined && patch.assignee_id !== current.assignee_id && !isLead && current.assignee_id !== ctx.user.id) {
    throw forbidden('Only a team lead or the current owner can reassign this task');
  }

  const update: Record<string, unknown> = {};
  const events: [string, string | null, string | null, string | null][] = [];
  const note = patch.note ?? null;

  if (patch.title !== undefined && patch.title !== current.title) {
    update.title = patch.title;
    events.push(['updated', current.title, patch.title, 'Title changed']);
  }
  if (patch.description !== undefined && (patch.description ?? null) !== current.description) update.description = patch.description ?? null;
  if (patch.priority && patch.priority !== current.priority) {
    update.priority = patch.priority;
    events.push(['priority_changed', current.priority, patch.priority, note]);
  }
  if (patch.due_date !== undefined) {
    const due = normalizeDue(patch.due_date);
    if ((due ?? null) !== (current.due_date ? new Date(current.due_date).toISOString() : null)) {
      update.due_date = due;
      events.push(['due_date_changed', fmtDate(current.due_date), fmtDate(due), note]);
    }
  }
  let reassignedTo: string | null | undefined;
  if (patch.assignee_id !== undefined && (patch.assignee_id ?? null) !== current.assignee_id) {
    if (patch.assignee_id) await assertMember(ctx, patch.assignee_id);
    update.assignee_id = patch.assignee_id ?? null;
    reassignedTo = patch.assignee_id ?? null;
    events.push(['reassigned', current.assignee_id, patch.assignee_id ?? null, note]);
  }
  if (patch.status && patch.status !== current.status) {
    if (patch.status === 'done') {
      const outcome = patch.outcome_notes?.trim();
      if (!outcome || outcome.length < 5) throw new ApiError(400, 'An outcome note (min 5 characters) is required to close a task');
      update.outcome_notes = outcome;
      update.completed_at = new Date().toISOString();
      events.push(['closed', current.status, 'done', outcome]);
    } else {
      if (current.status === 'done') update.completed_at = null;
      events.push(['status_changed', current.status, patch.status, note]);
    }
    update.status = patch.status;
  } else if (patch.outcome_notes !== undefined && current.status === 'done') {
    update.outcome_notes = patch.outcome_notes;
  }

  if (Object.keys(update).length === 0) {
    if (note) await event(ctx, id, 'comment_added', null, null, note, log);
    return current;
  }

  const updated = check(
    await ctx.supabase.from('action_items').update(update).eq('id', id).select('*').single(),
    'updating task',
  );
  for (const [type, prev, next, n] of events) await event(ctx, id, type, prev, next, n, log);

  const action = update.status === 'done' ? 'task.closed' : reassignedTo !== undefined ? 'task.reassigned' : update.status ? 'task.status_changed' : 'task.updated';
  await logActivity(ctx, action, 'action_item', id, { title: updated.title, changes: Object.keys(update), to: update.status ?? undefined }, log);
  log.info({ taskId: id, changes: Object.keys(update) }, action);

  // Tell the person who created the task when it is completed or gets blocked.
  const watcher = updated.creator_id && updated.creator_id !== updated.assignee_id ? updated.creator_id : null;
  if (watcher && (update.status === 'done' || update.status === 'blocked')) {
    const done = update.status === 'done';
    await notify(
      {
        workspaceId: ctx.workspace.id,
        userId: watcher,
        actorId: ctx.user.id,
        event: done ? 'task_completed' : 'task_blocked',
        title: done ? 'Task completed' : 'Task blocked',
        message: done
          ? `${ctx.profile.full_name} completed "${updated.title}". Outcome: ${String(update.outcome_notes ?? '').slice(0, 300)}`
          : `${ctx.profile.full_name} marked "${updated.title}" as blocked${note ? `: ${note}` : ''}.`,
        targetType: 'action_item',
        targetId: id,
        linkPath: `/tasks/${id}`,
        dedupeKey: `${done ? 'completed' : 'blocked'}:${id}:${Date.now()}`,
      },
      log,
    );
  }

  if (reassignedTo) {
    await notify(
      {
        workspaceId: ctx.workspace.id,
        userId: reassignedTo,
        actorId: ctx.user.id,
        event: 'task_reassigned',
        title: 'Task reassigned to you',
        message: `${ctx.profile.full_name} reassigned "${updated.title}" to you${updated.due_date ? ` — due ${fmtDate(updated.due_date)}` : ''}.${note ? ` Note: ${note}` : ''}`,
        targetType: 'action_item',
        targetId: id,
        linkPath: `/tasks/${id}`,
        dedupeKey: `reassigned:${id}:${reassignedTo}:${Date.now()}`,
      },
      log,
    );
  }
  return updated;
}

export async function carryForward(ctx: AppContext, meetingId: string, taskIds: string[], log: Logger) {
  const meeting = check(
    await ctx.supabase.from('meetings').select('id,title,status').eq('id', meetingId).eq('workspace_id', ctx.workspace.id).maybeSingle(),
    'loading meeting',
  );
  if (!meeting) throw notFound('Meeting');
  const tasks = check(
    await ctx.supabase.from('action_items').select('id,title,status').in('id', taskIds).eq('workspace_id', ctx.workspace.id),
    'loading tasks',
  ) as { id: string; title: string; status: string }[];
  const open = tasks.filter((t) => t.status !== 'done');
  if (open.length === 0) throw new ApiError(400, 'No unresolved tasks selected');

  const { data: existing } = await ctx.supabase.from('meeting_action_items').select('action_item_id').eq('meeting_id', meetingId);
  const already = new Set((existing ?? []).map((r) => r.action_item_id));
  const fresh = open.filter((t) => !already.has(t.id));
  if (fresh.length) {
    check(
      await ctx.supabase.from('meeting_action_items').insert(
        fresh.map((t) => ({ meeting_id: meetingId, action_item_id: t.id, is_carried_forward: true, notes: 'Carried forward (unresolved)' })),
      ),
      'carrying tasks forward',
    );
    for (const t of fresh) await event(ctx, t.id, 'carried_forward', null, meetingId, `Carried into "${meeting.title}"`, log);
    const { data: owners } = await ctx.supabase.from('action_items').select('id,title,assignee_id').in('id', fresh.map((t) => t.id)).not('assignee_id', 'is', null);
    const { data: m } = await ctx.supabase.from('meetings').select('scheduled_at').eq('id', meetingId).single();
    const when = m ? new Date(m.scheduled_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '';
    for (const o of owners ?? []) {
      await notify(
        {
          workspaceId: ctx.workspace.id,
          userId: o.assignee_id!,
          actorId: ctx.user.id,
          event: 'agenda_added',
          title: 'Your task is on the next meeting agenda',
          message: `"${o.title}" was carried into "${meeting.title}" (${when} IST). Be ready with an update.`,
          targetType: 'meeting',
          targetId: meetingId,
          linkPath: `/meetings/${meetingId}`,
          dedupeKey: `agenda:${meetingId}:${o.id}`,
        },
        log,
      );
    }
    await logActivity(ctx, 'task.carried_forward', 'meeting', meetingId, { meeting: meeting.title, count: fresh.length, tasks: fresh.map((t) => t.title) }, log);
  }
  log.info({ meetingId, carried: fresh.length, skipped: open.length - fresh.length }, 'carry-forward');
  return { carried: fresh.length, alreadyLinked: open.length - fresh.length };
}
