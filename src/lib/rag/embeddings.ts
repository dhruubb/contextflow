/**
 * Groq-only embeddings (optional). No server-only import: also used by the seed script.
 *
 * Groq's public model list currently has no embedding model, so ContextFlow's RAG runs in
 * Groq-only "lexical" mode by default (Groq query expansion → Postgres full-text → Groq re-rank → Groq answer).
 * If your Groq account has access to an embedding model on the OpenAI-compatible /embeddings endpoint
 * (the SDK types `nomic-embed-text-v1_5`, 768-d), set GROQ_EMBEDDING_MODEL to also enable pgvector search.
 */
export const EMBEDDING_DIM = 768;

export function embeddingsEnabled(): boolean {
  return Boolean(process.env.GROQ_EMBEDDING_MODEL && process.env.GROQ_API_KEY);
}

export function embeddingModel(): string | null {
  return embeddingsEnabled() ? process.env.GROQ_EMBEDDING_MODEL! : null;
}

function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

/** Embeds texts via Groq's OpenAI-compatible endpoint, batched, with retries on 429/5xx. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const model = embeddingModel();
  if (!model) throw new Error('GROQ_EMBEDDING_MODEL is not set');
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 64) {
    const input = texts.slice(i, i + 64).map((t) => t.slice(0, 6000));
    let json: { data?: { embedding: number[]; index: number }[]; error?: { message?: string } } | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await fetch('https://api.groq.com/openai/v1/embeddings', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        body: JSON.stringify({ model, input, encoding_format: 'float' }),
        signal: AbortSignal.timeout(30_000),
      });
      json = await res.json().catch(() => null);
      if (res.ok) break;
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await new Promise((r) => setTimeout(r, 1000 * attempt * attempt));
        continue;
      }
      throw new Error(`Groq embeddings failed (${res.status}): ${json?.error?.message ?? 'unknown error'}`);
    }
    const vectors = (json?.data ?? []).sort((a, b) => a.index - b.index).map((d) => d.embedding);
    if (vectors.length !== input.length || vectors.some((v) => v.length !== EMBEDDING_DIM)) {
      throw new Error(`Groq embeddings returned ${vectors[0]?.length ?? 0}-d vectors; the database expects ${EMBEDDING_DIM}-d`);
    }
    out.push(...vectors.map(normalize));
  }
  return out;
}

/** pgvector text literal */
export const toVector = (v: number[]) => `[${v.map((x) => x.toFixed(7)).join(',')}]`;
