import 'server-only';
import type { AppContext } from '@/lib/auth';

/** Collects the factual context (task history, source meetings, decisions, documents) for a handover. */
export async function gatherHandoverContext(ctx: AppContext, outgoingId: string, incomingId: string, taskIds: string[]) {
  const [{ data: tasks }, { data: people }] = await Promise.all([
    ctx.supabase
      .from('action_items')
      .select('id,title,description,status,priority,due_date,assignee_id,source_meeting_id,meeting:meetings!action_items_source_meeting_id_fkey(id,title,scheduled_at,summary)')
      .in('id', taskIds)
      .eq('workspace_id', ctx.workspace.id),
    ctx.supabase.from('profiles').select('id,full_name').in('id', [outgoingId, incomingId]),
  ]);
  type Row = { id: string; title: string; description: string | null; status: string; priority: string; due_date: string | null; assignee_id: string | null; source_meeting_id: string | null; meeting: { id: string; title: string; scheduled_at: string; summary: string | null } | null };
  const rows = (tasks ?? []) as unknown as Row[];
  const ids = rows.map((t) => t.id);
  const meetingIds = Array.from(new Set(rows.map((t) => t.source_meeting_id).filter(Boolean))) as string[];

  const [{ data: events }, { data: decisions }, { data: docs }] = await Promise.all([
    ids.length ? ctx.supabase.from('task_events').select('task_id,event_type,previous_value,new_value,notes,created_at').in('task_id', ids).order('created_at') : Promise.resolve({ data: [] }),
    meetingIds.length ? ctx.supabase.from('decisions').select('meeting_id,title,rationale').in('meeting_id', meetingIds) : Promise.resolve({ data: [] }),
    ids.length ? ctx.supabase.from('knowledge_links').select('target_id, document:knowledge_documents(id,title,extracted_text)').in('target_id', ids) : Promise.resolve({ data: [] }),
  ]);
  const name = (id: string) => people?.find((p) => p.id === id)?.full_name ?? 'Unknown';

  return {
    outgoing: name(outgoingId),
    incoming: name(incomingId),
    tasks: rows.map((t) => ({
      task_id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      due: t.due_date?.slice(0, 10) ?? null,
      source_meeting: t.meeting ? { title: t.meeting.title, date: t.meeting.scheduled_at.slice(0, 10), summary: t.meeting.summary } : null,
      decisions: ((decisions ?? []) as { meeting_id: string; title: string; rationale: string | null }[]).filter((d) => d.meeting_id === t.source_meeting_id).map((d) => ({ title: d.title, rationale: d.rationale })),
      history: ((events ?? []) as { task_id: string; event_type: string; previous_value: string | null; new_value: string | null; notes: string | null; created_at: string }[])
        .filter((e) => e.task_id === t.id)
        .map((e) => ({ event: e.event_type, notes: e.notes, at: e.created_at.slice(0, 10) })),
      documents: ((docs ?? []) as unknown as { target_id: string; document: { title: string; extracted_text: string | null } | null }[])
        .filter((d) => d.target_id === t.id && d.document)
        .map((d) => ({ title: d.document!.title, excerpt: d.document!.extracted_text?.slice(0, 1200) ?? null })),
    })),
  };
}
