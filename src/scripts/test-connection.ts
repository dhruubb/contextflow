import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  const checks: [string, () => PromiseLike<{ error: { message: string } | null }>][] = [
    ['tables (migration 001)', () => db.from('workspaces').select('id', { head: true, count: 'exact' })],
    ['search column (migration 002)', () => db.from('meetings').select('search', { head: true })],
    ['role helpers (migration 002)', () => db.rpc('ws_role', { ws: '00000000-0000-0000-0000-000000000000' })],
    ['RAG chunks table (migration 003)', () => db.from('document_chunks').select('id', { head: true, count: 'exact' })],
    ['storage bucket "documents"', async () => { const r = await db.storage.getBucket('documents'); return { error: r.error }; }],
  ];
  let ok = true;
  for (const [label, fn] of checks) {
    const { error } = await fn();
    console.log(`${error ? '✗' : '✓'} ${label}${error ? ` — ${error.message}` : ''}`);
    if (error) ok = false;
  }
  process.exit(ok ? 0 : 1);
}
main();
