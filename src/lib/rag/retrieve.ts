import 'server-only';
import type { AppContext } from '@/lib/auth';
import type { Logger } from '@/lib/logger';
import { ApiError } from '@/lib/api';
import { generateJSON } from '@/lib/ai/groq';
import { QueryExpansionZ, RerankZ, queryExpansionPrompt, rerankPrompt } from '@/lib/ai/prompts';
import { embedTexts, embeddingsEnabled, toVector } from './embeddings';

export interface RetrievedChunk {
  chunk_id: string;
  document_id: string;
  title: string;
  file_name: string;
  chunk_index: number;
  page_start: number | null;
  page_end: number | null;
  content: string;
  similarity: number;
  keyword_rank: number;
  score: number;
  rerank_score?: number;
}

const STOP = new Set('the a an and or but of to in on for with is are was were be been what which who whom whose when where why how does do did can could should would will shall may might must this that these those it its our your their there here from by as at about into over under than then so if not no yes any all some me my we you they he she them us i'.split(' '));

/** Natural-language question → OR keyword query for websearch_to_tsquery. */
export function keywordQuery(q: string): string {
  const words = Array.from(new Set(q.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? [])).filter((w) => !STOP.has(w));
  return words.slice(0, 12).join(' or ');
}

function termsToQuery(terms: string[]): string {
  const cleaned = Array.from(
    new Set(terms.map((t) => t.toLowerCase().replace(/["'():|&!<>]/g, ' ').replace(/\s+/g, ' ').trim()).filter((t) => t.length >= 2 && !STOP.has(t))),
  ).slice(0, 20);
  return cleaned.map((t) => (t.includes(' ') ? `"${t}"` : t)).join(' or ');
}

/**
 * Groq-only retrieval pipeline:
 *  1. Groq expands the question into search keywords/synonyms (falls back to raw keywords on failure).
 *  2. `match_document_chunks` (USER session → RLS + workspace check) returns full-text candidates,
 *     fused with pgvector similarity when Groq embeddings are enabled.
 *  3. Groq re-ranks the candidates and drops irrelevant ones.
 * Only chunks the caller is authorised to read are ever placed in a prompt.
 */
export async function retrieveChunks(ctx: AppContext, question: string, opts: { documentIds?: string[]; k?: number; log?: Logger } = {}) {
  const k = opts.k ?? 8;
  const log = opts.log;
  const started = Date.now();

  // 1. Query expansion (Groq)
  let terms: string[] = [];
  let rewritten = question;
  const exp = await generateJSON({ ctx, type: 'kb_answer', schema: QueryExpansionZ, ...queryExpansionPrompt(question), log, record: false, reasoningEffort: 'low', temperature: 0 });
  if (exp.ok) {
    terms = exp.data.keywords;
    rewritten = exp.data.rewritten || question;
  } else {
    log?.warn({ err: exp.error }, 'query expansion failed — using raw keywords');
  }
  const text = [termsToQuery(terms), keywordQuery(question)].filter(Boolean).join(' or ');

  // 2. Candidate retrieval (full-text, + vectors if Groq embeddings are enabled)
  let embedding: string | null = null;
  if (embeddingsEnabled()) {
    try {
      embedding = toVector((await embedTexts([rewritten]))[0]);
    } catch (e) {
      log?.warn({ err: (e as Error).message }, 'query embedding failed — keyword retrieval only');
    }
  }
  const { data, error } = await ctx.supabase.rpc('match_document_chunks', {
    p_workspace: ctx.workspace.id,
    p_query_embedding: embedding,
    p_query_text: text || null,
    p_match_count: Math.max(k * 3, 20),
    p_document_ids: opts.documentIds?.length ? opts.documentIds : null,
  });
  if (error) throw new ApiError(500, `Retrieval failed: ${error.message}`);
  const candidates = (data ?? []) as RetrievedChunk[];
  const mode: 'hybrid' | 'keyword' = embedding ? 'hybrid' : 'keyword';

  // 3. Re-rank (Groq)
  let chunks = candidates.slice(0, k);
  let reranked = false;
  if (candidates.length > 1) {
    const ids = candidates.map((_, i) => `P${i + 1}`);
    const rr = await generateJSON({
      ctx,
      type: 'kb_answer',
      schema: RerankZ,
      ...rerankPrompt(question, candidates.map((c, i) => ({ id: ids[i], document: c.title, text: c.content.slice(0, 900) }))),
      log,
      record: false,
      reasoningEffort: 'low',
      temperature: 0,
    });
    if (rr.ok) {
      const byId = new Map(ids.map((id, i) => [id, candidates[i]]));
      chunks = rr.data.relevant
        .filter((r) => byId.has(r.id) && r.score >= 3)
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
        .map((r) => ({ ...byId.get(r.id)!, rerank_score: r.score }));
      reranked = true;
    } else {
      log?.warn({ err: rr.error }, 're-rank failed — using retrieval order');
    }
  }

  log?.info({ mode, candidates: candidates.length, kept: chunks.length, reranked, terms: terms.length, retrievalMs: Date.now() - started }, 'rag retrieval');
  return { chunks, mode, reranked, terms };
}

export function citationLabel(c: Pick<RetrievedChunk, 'page_start' | 'page_end' | 'chunk_index'>) {
  if (c.page_start) return c.page_end && c.page_end !== c.page_start ? `pp. ${c.page_start}–${c.page_end}` : `p. ${c.page_start}`;
  return `chunk ${c.chunk_index + 1}`;
}
