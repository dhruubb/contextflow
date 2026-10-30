import { z } from 'zod';
import { route, ApiError, zId } from '@/lib/api';
import { generateJSON } from '@/lib/ai/groq';
import { KbAnswerZ, kbAnswerPrompt } from '@/lib/ai/prompts';
import { citationLabel, retrieveChunks } from '@/lib/rag/retrieve';

export const maxDuration = 60;

const AskZ = z.object({
  question: z.string().trim().min(3).max(1000),
  document_ids: z.array(zId).max(20).optional(),
});

const INSUFFICIENT = "I couldn't find anything in this workspace's knowledge base that answers this question. Try rephrasing, or upload the relevant document.";

/**
 * Groq-only RAG Q&A: Groq query expansion → full-text (+ optional Groq-embedding) retrieval scoped by RLS
 * → Groq re-rank → Groq answer grounded on the kept chunks, with [S#] citations.
 * Only chunks returned under the caller's own session are ever placed in the prompt.
 */
export const POST = route({ body: AskZ, permission: 'knowledge.ask' }, async ({ ctx, body, log }) => {
  const { chunks, mode, reranked } = await retrieveChunks(ctx, body.question, { documentIds: body.document_ids, k: 8, log });

  const sources = chunks.map((c, i) => ({
    id: `S${i + 1}`,
    document_id: c.document_id,
    title: c.title,
    file_name: c.file_name,
    location: citationLabel(c),
    chunk_index: c.chunk_index,
    similarity: Math.round(c.similarity * 100) / 100,
    relevance: c.rerank_score ?? null,
    snippet: c.content.length > 400 ? `${c.content.slice(0, 400)}…` : c.content,
    content: c.content,
  }));

  if (sources.length === 0) {
    log.info({ mode }, 'rag: no relevant chunks');
    return { answer: INSUFFICIENT, insufficient: true, sources: [], mode, reranked };
  }

  const prompt = kbAnswerPrompt(
    body.question,
    sources.map((s) => ({ id: s.id, document: s.title, location: s.location, text: s.content })),
  );
  const result = await generateJSON({ ctx, type: 'kb_answer', schema: KbAnswerZ, system: prompt.system, user: prompt.user, log, temperature: 0.1 });
  if (!result.ok) throw new ApiError(502, result.error);

  const valid = new Set(sources.map((s) => s.id));
  const inline = Array.from(result.data.answer.matchAll(/\[(S\d+)\]/g)).map((m) => m[1]);
  const cited = Array.from(new Set([...result.data.citations, ...inline])).filter((id) => valid.has(id));
  // Strip any citation markers that point to sources that don't exist.
  const answer = result.data.answer.replace(/\[(S\d+)\]/g, (m, id) => (valid.has(id) ? m : ''));
  const insufficient = result.data.insufficient || cited.length === 0;

  log.info({ mode, sources: sources.length, cited: cited.length, insufficient, latencyMs: result.latencyMs }, 'rag answer');
  return {
    answer,
    insufficient,
    mode,
    reranked,
    model: result.model,
    sources: sources.map(({ content: _c, ...s }) => ({ ...s, cited: cited.includes(s.id) })),
  };
});
