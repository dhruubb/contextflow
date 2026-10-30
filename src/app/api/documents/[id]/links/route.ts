import { z } from 'zod';
import { route, check, notFound, zId } from '@/lib/api';
import { logActivity } from '@/lib/activity';

const LinkZ = z.object({
  target_type: z.enum(['action_item', 'meeting', 'decision']),
  target_id: zId,
  relevance: z.number().min(0).max(1).nullish(),
  reason: z.string().max(500).nullish(),
});

const TABLE = { action_item: 'action_items', meeting: 'meetings', decision: 'decisions' } as const;

/** Approves a document → task/meeting/decision link. */
export const POST = route({ body: LinkZ, permission: 'document.link' }, async ({ ctx, body, params, log }) => {
  const doc = check(await ctx.supabase.from('knowledge_documents').select('id,title').eq('id', params.id).eq('workspace_id', ctx.workspace.id).maybeSingle(), 'loading document');
  if (!doc) throw notFound('Document');
  const target = check(await ctx.supabase.from(TABLE[body.target_type]).select('id').eq('id', body.target_id).eq('workspace_id', ctx.workspace.id).maybeSingle(), 'loading target');
  if (!target) throw notFound('Link target');

  check(
    await ctx.supabase.from('knowledge_links').upsert(
      { document_id: doc.id, target_type: body.target_type, target_id: body.target_id, relevance_score: body.relevance ?? null, reason: body.reason ?? null },
      { onConflict: 'document_id,target_type,target_id' },
    ),
    'linking document',
  );
  if (body.target_type === 'action_item') {
    await ctx.supabase.from('task_events').insert({ task_id: body.target_id, event_type: 'document_linked', actor_id: ctx.user.id, new_value: doc.id, notes: `Linked "${doc.title}"` });
  }
  await logActivity(ctx, 'document.linked', body.target_type, body.target_id, { document: doc.title }, log);
  return { ok: true };
});
