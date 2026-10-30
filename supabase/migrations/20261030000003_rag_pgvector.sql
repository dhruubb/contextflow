-- ContextFlow AI — Migration 003: RAG pipeline (pgvector)
-- Run AFTER migrations 001 and 002. Safe to re-run.
-- Embeddings are 768-dim (Gemini gemini-embedding-001 or OpenAI text-embedding-3-small with dimensions=768).

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- 1. Document processing state + duplicate protection
-- ---------------------------------------------------------------------------
ALTER TABLE public.knowledge_documents ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE public.knowledge_documents DROP CONSTRAINT IF EXISTS knowledge_documents_status_check;
ALTER TABLE public.knowledge_documents ADD CONSTRAINT knowledge_documents_status_check
  CHECK (status IN ('pending', 'processing', 'ready', 'failed'));
ALTER TABLE public.knowledge_documents ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE public.knowledge_documents ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE public.knowledge_documents ADD COLUMN IF NOT EXISTS page_count INTEGER;
ALTER TABLE public.knowledge_documents ADD COLUMN IF NOT EXISTS chunk_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.knowledge_documents ADD COLUMN IF NOT EXISTS embedding_model TEXT;
ALTER TABLE public.knowledge_documents ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMPTZ;
ALTER TABLE public.knowledge_documents ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;

-- Same file (by SHA-256) can only be indexed once per workspace
CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_documents_hash
  ON public.knowledge_documents(workspace_id, content_hash) WHERE content_hash IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Chunks + embeddings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.knowledge_documents(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  page_start INTEGER,
  page_end INTEGER,
  char_count INTEGER NOT NULL,
  embedding extensions.vector(768),
  fts tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_document_chunks_workspace ON public.document_chunks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_document ON public.document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_fts ON public.document_chunks USING GIN(fts);
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding ON public.document_chunks
  USING hnsw (embedding extensions.vector_cosine_ops);

-- Chunk rows must belong to the same workspace as their document
CREATE OR REPLACE FUNCTION public.document_chunks_ws_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM public.document_ws(NEW.document_id) THEN
    RAISE EXCEPTION 'chunk workspace does not match document workspace';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_document_chunks_ws_guard ON public.document_chunks;
CREATE TRIGGER trg_document_chunks_ws_guard BEFORE INSERT OR UPDATE ON public.document_chunks
  FOR EACH ROW EXECUTE FUNCTION public.document_chunks_ws_guard();

ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dc_select ON public.document_chunks;
DROP POLICY IF EXISTS dc_insert ON public.document_chunks;
DROP POLICY IF EXISTS dc_delete ON public.document_chunks;
CREATE POLICY dc_select ON public.document_chunks FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY dc_insert ON public.document_chunks FOR INSERT TO authenticated WITH CHECK (public.can_write(workspace_id));
CREATE POLICY dc_delete ON public.document_chunks FOR DELETE TO authenticated USING (public.can_write(workspace_id));

-- AI audit log: allow the new knowledge-base answer type
ALTER TABLE public.ai_generations DROP CONSTRAINT IF EXISTS ai_generations_generation_type_check;
ALTER TABLE public.ai_generations ADD CONSTRAINT ai_generations_generation_type_check CHECK (generation_type IN (
  'meeting_summary', 'action_items_extract', 'catch_up_brief', 'handover_context', 'continuity_risk', 'doc_linking', 'kb_answer'));

-- ---------------------------------------------------------------------------
-- 3. Hybrid retrieval (semantic + keyword, reciprocal rank fusion)
--    SECURITY INVOKER: RLS on chunks/documents applies, plus an explicit membership check.
--    Pass p_query_embedding = NULL for keyword-only search (no embedding provider configured).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_document_chunks(
  p_workspace UUID,
  p_query_embedding extensions.vector(768),
  p_query_text TEXT,
  p_match_count INT DEFAULT 8,
  p_document_ids UUID[] DEFAULT NULL
) RETURNS TABLE (
  chunk_id UUID, document_id UUID, title TEXT, file_name TEXT, chunk_index INT,
  page_start INT, page_end INT, content TEXT, similarity FLOAT, keyword_rank FLOAT, score FLOAT
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, extensions AS $$
  WITH base AS (
    SELECT c.id, c.document_id, c.chunk_index, c.page_start, c.page_end, c.content, c.embedding, c.fts, d.title, d.file_name
    FROM public.document_chunks c
    JOIN public.knowledge_documents d ON d.id = c.document_id
    WHERE c.workspace_id = p_workspace
      AND d.workspace_id = p_workspace
      AND d.status = 'ready'
      AND public.is_workspace_member(p_workspace)
      AND (p_document_ids IS NULL OR c.document_id = ANY(p_document_ids))
  ),
  semantic AS (
    SELECT id, 1 - (embedding <=> p_query_embedding) AS sim,
           row_number() OVER (ORDER BY embedding <=> p_query_embedding) AS rnk
    FROM base
    WHERE p_query_embedding IS NOT NULL AND embedding IS NOT NULL
    ORDER BY embedding <=> p_query_embedding
    LIMIT greatest(p_match_count, 1) * 4
  ),
  keyword AS (
    SELECT b.id, ts_rank_cd(b.fts, q) AS kr, row_number() OVER (ORDER BY ts_rank_cd(b.fts, q) DESC) AS rnk
    FROM base b, websearch_to_tsquery('english', coalesce(p_query_text, '')) q
    WHERE coalesce(p_query_text, '') <> '' AND b.fts @@ q
    ORDER BY kr DESC
    LIMIT greatest(p_match_count, 1) * 4
  )
  SELECT b.id, b.document_id, b.title, b.file_name, b.chunk_index, b.page_start, b.page_end, b.content,
         coalesce(s.sim, 0)::float, coalesce(k.kr, 0)::float,
         (coalesce(1.0 / (60 + s.rnk), 0) + coalesce(1.0 / (60 + k.rnk), 0))::float AS score
  FROM base b
  LEFT JOIN semantic s ON s.id = b.id
  LEFT JOIN keyword k ON k.id = b.id
  WHERE s.id IS NOT NULL OR k.id IS NOT NULL
  ORDER BY score DESC, coalesce(s.sim, 0) DESC
  LIMIT greatest(p_match_count, 1);
$$;

REVOKE ALL ON FUNCTION public.match_document_chunks(UUID, extensions.vector, TEXT, INT, UUID[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.match_document_chunks(UUID, extensions.vector, TEXT, INT, UUID[]) TO authenticated;
