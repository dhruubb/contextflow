/**
 * Demo seed for the NovaTech workspace.
 * - Creates (or reuses) five real Supabase Auth users with a shared demo password.
 * - RESETS ONLY the workspace with slug "novatech" (cascade), then recreates realistic data.
 * - Uploads two real text documents to the private "documents" storage bucket.
 *
 * Usage: npm run seed   (requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local
 *                        and both SQL migrations applied)
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { createHash } from 'node:crypto';
import { chunkPages } from '../lib/rag/chunk';
import { embedTexts, embeddingModel, embeddingsEnabled, toVector } from '../lib/rag/embeddings';

dotenv.config({ path: '.env.local', quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'NovaTech@2026';

if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const USERS = [
  { key: 'aisha', email: 'aisha@novatech.io', full_name: 'Aisha Khan', role: 'admin' },
  { key: 'rahul', email: 'rahul@novatech.io', full_name: 'Rahul Sharma', role: 'team_lead' },
  { key: 'priya', email: 'priya@novatech.io', full_name: 'Priya Patel', role: 'member' },
  { key: 'arjun', email: 'arjun@novatech.io', full_name: 'Arjun Mehta', role: 'member' },
  { key: 'neha', email: 'neha@novatech.io', full_name: 'Neha Gupta', role: 'viewer' },
] as const;
type Key = (typeof USERS)[number]['key'];

const DAY = 86_400_000;
const at = (days: number, hour = 10) => {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(hour - 5, 30, 0, 0); // ~hour:00 IST
  return d.toISOString();
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function must<R extends { data: any; error: { message: string } | null }>(res: R, label: string): NonNullable<R['data']> {
  if (res.error) throw new Error(`${label}: ${res.error.message}`);
  return res.data;
}

async function ensureUsers(): Promise<Record<Key, string>> {
  const ids = {} as Record<Key, string>;
  const existing = must(await db.auth.admin.listUsers({ page: 1, perPage: 1000 }), 'listUsers');
  for (const u of USERS) {
    let user = existing.users.find((x) => x.email?.toLowerCase() === u.email);
    if (!user) {
      const created = must(
        await db.auth.admin.createUser({
          email: u.email,
          password: DEMO_PASSWORD,
          email_confirm: true,
          user_metadata: { full_name: u.full_name },
        }),
        `createUser ${u.email}`,
      );
      user = created.user!;
      console.log(`  + auth user ${u.email}`);
    } else {
      await db.auth.admin.updateUserById(user.id, { password: DEMO_PASSWORD, email_confirm: true });
      console.log(`  = auth user ${u.email} (password reset to demo password)`);
    }
    ids[u.key] = user.id;
  }
  return ids;
}

async function main() {
  console.log('Seeding NovaTech demo workspace…');

  // 1. Reset only the demo workspace (cascades to all workspace data)
  must(await db.from('workspaces').delete().eq('slug', 'novatech'), 'reset workspace');

  // 2. Auth users + profiles (remove legacy profiles from the old seed that have no auth user)
  const ids = await ensureUsers();
  const emails = USERS.map((u) => u.email);
  const { data: legacy } = await db.from('profiles').select('id,email').in('email', emails);
  for (const p of legacy ?? []) {
    if (!Object.values(ids).includes(p.id)) await db.from('profiles').delete().eq('id', p.id);
  }
  must(
    await db.from('profiles').upsert(
      USERS.map((u) => ({ id: ids[u.key], email: u.email, full_name: u.full_name })),
      { onConflict: 'id' },
    ),
    'profiles',
  );

  // 3. Workspace + members
  const ws = must(
    await db.from('workspaces').insert({ name: 'NovaTech', slug: 'novatech' }).select().single(),
    'workspace',
  ) as { id: string };
  const W = ws.id;
  must(
    await db.from('workspace_members').insert(USERS.map((u) => ({ workspace_id: W, user_id: ids[u.key], role: u.role }))),
    'members',
  );
  must(
    await db.from('notification_preferences').upsert(
      USERS.map((u) => ({ user_id: ids[u.key], channel: 'telegram' })),
      { onConflict: 'user_id,channel' },
    ),
    'notification prefs',
  );

  // 4. Meetings
  const meetingRows = [
    {
      key: 'arch',
      title: 'Q4 Architecture & Security Review',
      agenda: '1. API latency spikes at peak load\n2. Database connection limits\n3. Row Level Security rollout\n4. Telegram webhook hardening',
      raw_notes:
        'Rahul walked through the p95 latency spikes (2.4s at 7pm peak). Root cause: Postgres connection exhaustion — the API opens a new connection per request.\n' +
        'Decision: move all serverless traffic to the Supabase transaction pooler (port 6543). Arjun owns this, target end of last week.\n' +
        'Decision: enforce RLS on every customer-facing table before the SOC2 audit. Priya to audit the API gateway middleware for RLS bypasses once she is back from client leave.\n' +
        'Rahul already rotated the Telegram webhook secret during the meeting.\n' +
        'Arjun to benchmark slow queries again after the index changes.\n' +
        'Priya was absent (client on-site).',
      summary:
        'Latency spikes traced to connection exhaustion; team will move to the transaction pooler and enforce RLS on all customer tables before the SOC2 audit.',
      status: 'completed',
      scheduled_at: at(-8),
      ended_at: at(-8, 11),
      created_by: ids.rahul,
    },
    {
      key: 'retro',
      title: 'Client Onboarding Retro — Meridian Health',
      agenda: 'What went well, what slowed onboarding, SLA reporting',
      raw_notes:
        'Onboarding took 9 days vs 5 planned. Main delay: SLA reporting template was missing.\n' +
        'Rahul started the client SLA report but is moving to the platform migration; Arjun will take it over.\n' +
        'Incident runbook is outdated (still references the old on-call rota) — nobody picked it up.\n' +
        'Decision: every new client gets an SLA report within 3 business days of go-live.',
      summary: 'Onboarding overran by 4 days due to missing SLA template. New rule: SLA report within 3 business days of go-live.',
      status: 'completed',
      scheduled_at: at(-4),
      ended_at: at(-4, 11),
      created_by: ids.rahul,
    },
    {
      key: 'sprint',
      title: 'Weekly Sprint Planning & Handover Sync',
      agenda: 'Review carried-forward infrastructure tasks, confirm handovers, plan sprint 44',
      raw_notes: null,
      summary: null,
      status: 'scheduled',
      scheduled_at: at(1),
      ended_at: null,
      created_by: ids.rahul,
    },
    {
      key: 'roadmap',
      title: 'Q1 Roadmap Kickoff',
      agenda: 'Product priorities for Q1, staffing, client commitments',
      raw_notes: null,
      summary: null,
      status: 'scheduled',
      scheduled_at: at(5),
      ended_at: null,
      created_by: ids.aisha,
    },
  ];
  const meetings = must(
    await db
      .from('meetings')
      .insert(meetingRows.map(({ key: _k, ...m }) => ({ ...m, workspace_id: W })))
      .select('id,title'),
    'meetings',
  ) as { id: string; title: string }[];
  const M: Record<string, string> = {};
  meetingRows.forEach((m) => (M[m.key] = meetings.find((x) => x.title === m.title)!.id));

  const participants: { meeting_id: string; user_id: string; attended: boolean }[] = [];
  const add = (mk: string, attended: Partial<Record<Key, boolean>>) =>
    Object.entries(attended).forEach(([k, a]) => participants.push({ meeting_id: M[mk], user_id: ids[k as Key], attended: !!a }));
  add('arch', { aisha: true, rahul: true, arjun: true, priya: false, neha: true }); // Priya missed
  add('retro', { aisha: true, rahul: true, arjun: true, priya: true });
  add('sprint', { aisha: false, rahul: false, arjun: false, priya: false, neha: false });
  add('roadmap', { aisha: false, rahul: false, priya: false, arjun: false, neha: false });
  must(await db.from('meeting_participants').insert(participants), 'participants');

  // 5. Decisions
  const decisions = must(
    await db
      .from('decisions')
      .insert([
        {
          workspace_id: W, meeting_id: M.arch, decided_by: ids.aisha,
          title: 'Route all serverless traffic through the transaction pooler',
          description: 'Use the Supabase transaction pooler (port 6543) for API and background jobs.',
          rationale: 'Per-request connections exhausted Postgres at peak load.',
        },
        {
          workspace_id: W, meeting_id: M.arch, decided_by: ids.aisha,
          title: 'Enforce RLS on every customer-facing table before the SOC2 audit',
          description: 'No table may be queried with the service role from user-facing code paths.',
          rationale: 'Prevents cross-tenant data leakage; required for SOC2.',
        },
        {
          workspace_id: W, meeting_id: M.retro, decided_by: ids.rahul,
          title: 'SLA report within 3 business days of client go-live',
          description: 'Every new client receives an SLA report within three business days.',
          rationale: 'Meridian onboarding overran because SLA reporting was missing.',
        },
      ])
      .select('id,title'),
    'decisions',
  ) as { id: string; title: string }[];

  // 6. Tasks
  const taskRows = [
    { key: 'pooler', title: 'Configure Supabase transaction pooler', description: 'Switch API + workers to port 6543, set pool size, load-test at 2x peak.', status: 'in_progress', priority: 'high', assignee: 'arjun', creator: 'rahul', meeting: 'arch', due: at(-2) },
    { key: 'rls', title: 'Audit API gateway middleware for RLS bypasses', description: 'Find every code path using the service role for user-facing reads.', status: 'todo', priority: 'high', assignee: 'priya', creator: 'rahul', meeting: 'arch', due: at(2) },
    { key: 'webhook', title: 'Rotate Telegram webhook secret', description: 'Rotate secret and verify X-Telegram-Bot-Api-Secret-Token on every request.', status: 'done', priority: 'medium', assignee: 'rahul', creator: 'aisha', meeting: 'arch', due: at(-7), outcome: 'Secret rotated and header verification deployed; zero failed deliveries since.' },
    { key: 'bench', title: 'Re-benchmark slow queries after index changes', description: 'Compare p95 of top 10 queries before/after new indexes.', status: 'todo', priority: 'low', assignee: 'arjun', creator: 'rahul', meeting: 'arch', due: at(6) },
    { key: 'sla', title: 'Prepare Meridian Health SLA report', description: 'First SLA report for Meridian: uptime, response times, incident summary.', status: 'blocked', priority: 'high', assignee: 'arjun', creator: 'rahul', meeting: 'retro', due: at(1) },
    { key: 'runbook', title: 'Update incident runbook with new on-call rota', description: 'Runbook still references the old rota and escalation numbers.', status: 'todo', priority: 'medium', assignee: null, creator: 'rahul', meeting: 'retro', due: at(-1) },
  ] as const;
  const tasks = must(
    await db
      .from('action_items')
      .insert(
        taskRows.map((t) => ({
          workspace_id: W,
          title: t.title,
          description: t.description,
          status: t.status,
          priority: t.priority,
          assignee_id: t.assignee ? ids[t.assignee] : null,
          creator_id: ids[t.creator],
          source_meeting_id: M[t.meeting],
          due_date: t.due,
          outcome_notes: 'outcome' in t ? t.outcome : null,
          completed_at: t.status === 'done' ? at(-7, 12) : null,
        })),
      )
      .select('id,title'),
    'tasks',
  ) as { id: string; title: string }[];
  const T: Record<string, string> = {};
  taskRows.forEach((t) => (T[t.key] = tasks.find((x) => x.title === t.title)!.id));

  // 7. Task history
  const ev = (task: string, event_type: string, actor: Key, prev: string | null, next: string | null, notes: string | null, days: number) => ({
    task_id: T[task], event_type, actor_id: ids[actor], previous_value: prev, new_value: next, notes, created_at: at(days),
  });
  must(
    await db.from('task_events').insert([
      ...taskRows.map((t) => ev(t.key, 'created', t.creator, null, 'todo', `Created from "${meetingRows.find((m) => m.key === t.meeting)!.title}"`, t.meeting === 'arch' ? -8 : -4)),
      ev('pooler', 'status_changed', 'arjun', 'todo', 'in_progress', 'Started pooler config on staging', -6),
      ev('pooler', 'carried_forward', 'rahul', null, M.sprint, 'Not finished — carried into sprint planning', -1),
      ev('webhook', 'closed', 'rahul', 'in_progress', 'done', 'Secret rotated and header verification deployed; zero failed deliveries since.', -7),
      ev('sla', 'handed_over', 'rahul', ids.rahul, ids.arjun, 'Rahul moved to platform migration', -3),
      ev('sla', 'status_changed', 'arjun', 'todo', 'blocked', 'Waiting on uptime export from monitoring vendor', -2),
    ]),
    'task events',
  );

  // 8. Meeting ↔ task links (originals + carry-forward)
  must(
    await db.from('meeting_action_items').insert([
      ...taskRows.map((t) => ({ meeting_id: M[t.meeting], action_item_id: T[t.key], is_carried_forward: false })),
      { meeting_id: M.sprint, action_item_id: T.pooler, is_carried_forward: true, notes: 'Overdue — carried from Q4 Architecture Review' },
    ]),
    'meeting links',
  );

  // 9. Completed handover Rahul → Arjun
  const ho = must(
    await db
      .from('handovers')
      .insert({
        workspace_id: W, outgoing_user_id: ids.rahul, incoming_user_id: ids.arjun, status: 'completed',
        notes: 'Rahul moving to platform migration for 3 weeks.', completed_at: at(-3), created_at: at(-3),
        ai_summary: JSON.stringify({
          overview: 'Rahul is handing over the Meridian Health SLA report while he moves to the platform migration.',
          tasks: [{ task_id: T.sla, context: 'Agreed in the Meridian onboarding retro; first SLA report for the client.', current_state: 'Template drafted, uptime numbers missing.', next_steps: ['Request uptime export from the monitoring vendor', 'Fill incident summary from the incident log'], risks: ['Client expects it within 3 business days of go-live'] }],
          open_questions: ['Which uptime source is authoritative for Meridian?'],
        }),
      })
      .select('id')
      .single(),
    'handover',
  ) as { id: string };
  must(await db.from('handover_items').insert({ handover_id: ho.id, action_item_id: T.sla, transferred: true, previous_assignee_id: ids.rahul }), 'handover items');

  // 10. Knowledge base: real files in Storage
  const docs = [
    {
      title: 'Database Connection Pooling Runbook',
      file: 'connection-pooling-runbook.txt',
      text:
        'NovaTech — Database Connection Pooling Runbook\n\n' +
        'Serverless functions must use the Supabase transaction pooler on port 6543. Session mode (5432) is reserved for migrations.\n' +
        'Pool size: 15 per service. Disable prepared statements when using transaction mode.\n' +
        'Load test: replay 2x peak traffic (7pm IST) for 20 minutes; p95 must stay under 400ms.\n' +
        'Rollback: switch DATABASE_URL back to the direct connection string and redeploy.',
    },
    {
      title: 'Client SLA Reporting Policy 2026',
      file: 'client-sla-policy-2026.txt',
      text:
        'NovaTech Client SLA Reporting Policy (2026)\n\n' +
        'Each new client receives an SLA report within 3 business days of go-live.\n' +
        'The report covers: monthly uptime (target 99.9%), median and p95 API response times, incidents with root cause, and open risks.\n' +
        'Uptime source of truth: the monitoring vendor export, not internal health checks.\n' +
        'Reports are reviewed by the team lead before being sent to the client.',
    },
  ];
  for (const d of docs) {
    const path = `${W}/${crypto.randomUUID()}-${d.file}`;
    const up = await db.storage.from('documents').upload(path, new Blob([d.text], { type: 'text/plain' }), { contentType: 'text/plain', upsert: true });
    if (up.error) throw new Error(`storage upload ${d.file}: ${up.error.message} (did you run migration 002?)`);
    const doc = must(
      await db
        .from('knowledge_documents')
        .insert({
          workspace_id: W, title: d.title, file_name: d.file, file_type: 'text/plain', file_size: Buffer.byteLength(d.text), storage_path: path,
          extracted_text: d.text, uploaded_by: ids.rahul, status: 'processing', content_hash: createHash('sha256').update(d.text).digest('hex'),
        })
        .select('id')
        .single(),
      'document',
    ) as { id: string };

    // RAG index: chunk (+ Groq embeddings if GROQ_EMBEDDING_MODEL is set; falls back to full-text only)
    const chunks = chunkPages([d.text]);
    let vectors: number[][] | null = null;
    const indexError: string | null = null;
    if (embeddingsEnabled()) {
      try {
        vectors = await embedTexts(chunks.map((c) => c.content));
      } catch (e) {
        console.log(`  ! Groq embeddings unavailable (${(e as Error).message}) — indexing for full-text search`);
      }
    }
    if (!indexError) {
      must(
        await db.from('document_chunks').insert(
          chunks.map((c, i) => ({
            document_id: doc.id, workspace_id: W, chunk_index: c.index, content: c.content, page_start: null, page_end: null,
            char_count: c.content.length, embedding: vectors ? toVector(vectors[i]) : null,
          })),
        ),
        'chunks (did you run migration 003?)',
      );
    }
    await db
      .from('knowledge_documents')
      .update(indexError
        ? { status: 'failed', error_message: indexError }
        : { status: 'ready', chunk_count: chunks.length, embedding_model: vectors ? embeddingModel() : null, indexed_at: new Date().toISOString() })
      .eq('id', doc.id);
    console.log(`  ${indexError ? '✗' : '✓'} indexed "${d.title}": ${indexError ?? `${chunks.length} chunk(s), ${vectors ? `Groq ${embeddingModel()}` : 'full-text index'}`}`);
    const target = d.file.startsWith('connection') ? T.pooler : T.sla;
    must(
      await db.from('knowledge_links').insert({ document_id: doc.id, target_type: 'action_item', target_id: target, relevance_score: 0.9, reason: 'Seeded reference document' }),
      'knowledge link',
    );
  }

  // 11. Activity feed
  must(
    await db.from('activity_events').insert([
      { workspace_id: W, actor_id: ids.rahul, action: 'meeting.completed', target_type: 'meeting', target_id: M.arch, metadata: { title: meetingRows[0].title }, created_at: at(-8, 11) },
      { workspace_id: W, actor_id: ids.rahul, action: 'task.closed', target_type: 'action_item', target_id: T.webhook, metadata: { title: 'Rotate Telegram webhook secret' }, created_at: at(-7) },
      { workspace_id: W, actor_id: ids.rahul, action: 'meeting.completed', target_type: 'meeting', target_id: M.retro, metadata: { title: meetingRows[1].title }, created_at: at(-4, 11) },
      { workspace_id: W, actor_id: ids.rahul, action: 'handover.completed', target_type: 'handover', target_id: ho.id, metadata: { from: 'Rahul Sharma', to: 'Arjun Mehta', tasks: 1 }, created_at: at(-3) },
      { workspace_id: W, actor_id: ids.arjun, action: 'task.status_changed', target_type: 'action_item', target_id: T.sla, metadata: { title: 'Prepare Meridian Health SLA report', to: 'blocked' }, created_at: at(-2) },
      { workspace_id: W, actor_id: ids.rahul, action: 'task.carried_forward', target_type: 'action_item', target_id: T.pooler, metadata: { title: 'Configure Supabase transaction pooler', meeting: 'Weekly Sprint Planning & Handover Sync' }, created_at: at(-1) },
    ]),
    'activity',
  );

  console.log(`\n✓ Seed complete. ${decisions.length} decisions, ${tasks.length} tasks, ${meetings.length} meetings, ${docs.length} documents.`);
  console.log(`  Log in with any of: ${emails.join(', ')}`);
  console.log(`  Demo password: ${DEMO_PASSWORD === 'NovaTech@2026' ? 'NovaTech@2026 (default; set DEMO_PASSWORD to change)' : '(value of DEMO_PASSWORD)'}`);
}

main().catch((e) => {
  console.error('\n✗ Seed failed:', e.message);
  process.exit(1);
});
