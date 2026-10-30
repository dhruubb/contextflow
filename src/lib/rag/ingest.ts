import 'server-only';
import type { AppContext } from '@/lib/auth';
import type { Logger } from '@/lib/logger';
import { ALLOWED, extractText } from '@/lib/extract';
import { chunkPages } from './chunk';
import { embedTexts, embeddingModel, embeddingsEnabled, toVector } from './embeddings';

export interface IndexResult {
  status: 'ready' | 'failed';
  chunkCount: number;
  embedded: boolean;
  error: string | null;
}

/**
 * Extract → chunk → embed → store. Idempotent: existing chunks for the document are replaced.
 * Failures mark the document `failed` with a reason (the file stays in Storage so it can be re-indexed).
 * Groq-only: chunks are always indexed for full-text search. If GROQ_EMBEDDING_MODEL is set they are also
 * embedded for pgvector; if embedding fails the document still becomes searchable (keyword mode) and the reason is recorded.
 */
export async function indexDocument(ctx: AppContext, documentId: string, kind: keyof typeof ALLOWED, bytes: Uint8Array, log: Logger): Promise<IndexResult> {
  const db = ctx.supabase;
  const l = log.child({ documentId, kind });
  const fail = async (stage: string, err: unknown): Promise<IndexResult> => {
    const message = `${stage} failed: ${(err as Error)?.message ?? String(err)}`.slice(0, 500);
    l.error({ stage, err: message }, 'document indexing failed');
    await db.from('document_chunks').delete().eq('document_id', documentId);
    await db.from('knowledge_documents').update({ status: 'failed', error_message: message, chunk_count: 0 }).eq('id', documentId);
    return { status: 'failed', chunkCount: 0, embedded: false, error: message };
  };

  await db.from('knowledge_documents').update({ status: 'processing', error_message: null, processing_started_at: new Date().toISOString() }).eq('id', documentId);

  // 1. Extract
  let extracted;
  const t0 = Date.now();
  try {
    extracted = await extractText(kind, bytes);
  } catch (e) {
    return fail('Text extraction', e);
  }
  if (!extracted.text) return fail('Text extraction', new Error('no extractable text (scanned PDF or empty file?)'));
  await db.from('knowledge_documents').update({ extracted_text: extracted.text, page_count: extracted.hasPages ? extracted.pages.length : null }).eq('id', documentId);

  // 2. Chunk
  const chunks = chunkPages(extracted.pages, { hasPages: extracted.hasPages });
  l.info({ chars: extracted.text.length, pages: extracted.pages.length, chunks: chunks.length, extractMs: Date.now() - t0 }, 'document chunked');

  // 3. Embed
  let vectors: number[][] | null = null;
  let embedWarning: string | null = null;
  if (embeddingsEnabled()) {
    const t1 = Date.now();
    try {
      vectors = await embedTexts(chunks.map((c) => c.content));
      l.info({ model: embeddingModel(), chunks: vectors.length, embedMs: Date.now() - t1 }, 'chunks embedded (groq)');
    } catch (e) {
      embedWarning = `Embeddings unavailable (${(e as Error).message}); indexed for keyword search`.slice(0, 500);
      l.warn({ err: (e as Error).message }, 'groq embedding failed — falling back to keyword index');
    }
  }

  // 4. Store (replace any previous chunks → no duplicate indexing)
  const del = await db.from('document_chunks').delete().eq('document_id', documentId);
  if (del.error) return fail('Removing old chunks', del.error);
  for (let i = 0; i < chunks.length; i += 100) {
    const rows = chunks.slice(i, i + 100).map((c, j) => ({
      document_id: documentId,
      workspace_id: ctx.workspace.id,
      chunk_index: c.index,
      content: c.content,
      page_start: c.pageStart,
      page_end: c.pageEnd,
      char_count: c.content.length,
      embedding: vectors ? toVector(vectors[i + j]) : null,
    }));
    const ins = await db.from('document_chunks').insert(rows);
    if (ins.error) return fail('Saving chunks', ins.error);
  }

  await db
    .from('knowledge_documents')
    .update({ status: 'ready', error_message: embedWarning, chunk_count: chunks.length, embedding_model: vectors ? embeddingModel() : null, indexed_at: new Date().toISOString() })
    .eq('id', documentId);
  l.info({ chunks: chunks.length, embedded: !!vectors }, 'document indexed');
  return { status: 'ready', chunkCount: chunks.length, embedded: !!vectors, error: null };
}
