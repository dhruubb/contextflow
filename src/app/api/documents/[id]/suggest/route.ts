import { route, check, notFound, ApiError } from '@/lib/api';
import { generateJSON } from '@/lib/ai/groq';
import { DocLinksZ, docLinksPrompt } from '@/lib/ai/prompts';

/** Retrieval (Postgres full-text) + Groq: suggest tasks/meetings/decisions this document should be linked to. */
export const POST = route({ permission: 'document.link' }, async ({ ctx, params, log }) => {
  const doc = check(
    await ctx.supabase.from('knowledge_documents').select('id,title,extracted_text').eq('id', params.id).eq('workspace_id', ctx.workspace.id).maybeSingle(),
    'loading document',
  );
  if (!doc) throw notFound('Document');
  if (!doc.extracted_text) throw new ApiError(400, 'This document has no extracted text to analyse');

  // Retrieval: keywords from the title + top terms → FTS over meetings; open tasks and recent decisions as candidates.
  const keywords = Array.from(new Set(`${doc.title} ${doc.extracted_text.slice(0, 600)}`.toLowerCase().match(/[a-z]{5,}/g) ?? [])).slice(0, 12);
  const [{ data: tasks }, { data: meetings }, { data: decisions }, { data: existing }] = await Promise.all([
    ctx.supabase.from('action_items').select('id,title,description,status').eq('workspace_id', ctx.workspace.id).neq('status', 'done').order('updated_at', { ascending: false }).limit(40),
    keywords.length
      ? ctx.supabase.from('meetings').select('id,title,summary').eq('workspace_id', ctx.workspace.id).textSearch('search', keywords.join(' | '), { config: 'english' }).limit(10)
      : ctx.supabase.from('meetings').select('id,title,summary').eq('workspace_id', ctx.workspace.id).order('scheduled_at', { ascending: false }).limit(10),
    ctx.supabase.from('decisions').select('id,title,description').eq('workspace_id', ctx.workspace.id).order('created_at', { ascending: false }).limit(20),
    ctx.supabase.from('knowledge_links').select('target_id').eq('document_id', doc.id),
  ]);

  const prompt = docLinksPrompt({
    document: { title: doc.title, excerpt: doc.extracted_text.slice(0, 6000) },
    candidates: {
      action_items: (tasks ?? []).map((t) => ({ id: t.id, title: t.title, description: t.description?.slice(0, 300) })),
      meetings: (meetings ?? []).map((m) => ({ id: m.id, title: m.title, summary: m.summary?.slice(0, 300) })),
      decisions: (decisions ?? []).map((d) => ({ id: d.id, title: d.title, description: d.description?.slice(0, 300) })),
    },
  });
  const result = await generateJSON({ ctx, type: 'doc_linking', schema: DocLinksZ, system: prompt.system, user: prompt.user, target: { type: 'document', id: doc.id }, log });
  if (!result.ok) throw new ApiError(502, result.error);

  const titles = new Map<string, string>([
    ...(tasks ?? []).map((t) => [t.id, t.title] as [string, string]),
    ...(meetings ?? []).map((m) => [m.id, m.title] as [string, string]),
    ...(decisions ?? []).map((d) => [d.id, d.title] as [string, string]),
  ]);
  const linked = new Set((existing ?? []).map((e) => e.target_id));
  const suggestions = result.data.links
    .filter((l) => titles.has(l.target_id) && !linked.has(l.target_id))
    .map((l) => ({ ...l, title: titles.get(l.target_id)! }));
  return { suggestions };
});
