import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });
import { embedTexts, embeddingModel, embeddingsEnabled } from '../lib/rag/embeddings';

/** Optional: checks whether your Groq account can serve embeddings (GROQ_EMBEDDING_MODEL). */
async function main() {
  if (!embeddingsEnabled()) {
    console.log('ℹ GROQ_EMBEDDING_MODEL not set — RAG runs in Groq-only full-text mode (expansion + re-rank). Nothing to test.');
    console.log('  To try Groq embeddings: GROQ_EMBEDDING_MODEL=nomic-embed-text-v1_5 npm run test:embed');
    return;
  }
  const [a, b, c] = await embedTexts(['Use the transaction pooler on port 6543.', 'Which port does the database pooler use?', 'Bananas are yellow.']);
  const cos = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i], 0);
  console.log(`✓ Groq ${embeddingModel()} → ${a.length} dims`);
  console.log(`  similarity(related)   = ${cos(a, b).toFixed(3)}`);
  console.log(`  similarity(unrelated) = ${cos(a, c).toFixed(3)}`);
}
main().catch((e) => {
  console.error(`✗ ${e.message}\n  → Leave GROQ_EMBEDDING_MODEL unset; RAG works without it.`);
  process.exit(1);
});
