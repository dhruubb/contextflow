# ContextFlow AI

AI-powered knowledge & task continuity platform. Captures meetings, extracts decisions and action items with Groq, tracks tasks through reassignments and handovers, carries unresolved work into the next meeting, and flags where context is being lost.

**Stack:** Next.js 16 (App Router, TypeScript) · Tailwind CSS with shadcn-style components · Supabase (Postgres + pgvector + Auth + Storage + RLS) · Groq (LLM + RAG) · Telegram Bot API · Pino · Zod · Vercel.

---

## 1. Setup (about 10 minutes)

**Requirements:** Node 20+, a Supabase project (free tier is fine), a Groq API key and optionally a Telegram bot. Nothing runs locally except Next.js. There's no Docker, local database or local model, and `node_modules` is about 530 MB.

```bash
npm install --no-audit --no-fund
cp .env.example .env.local      # fill in the values
```

**Database:** open Supabase → SQL Editor and run these two files **in order**:

1. `supabase/migrations/20261030000001_contextflow_schema.sql`: 18 tables, foreign keys and indexes.
2. `supabase/migrations/20261030000002_rls_fixes_search_storage.sql`: RLS policies for every table, role helpers, the profile-on-signup trigger, full-text search, notification dedupe, the atomic handover function, and the private `documents` storage bucket. Safe to re-run.
3. `supabase/migrations/20261030000003_rag_pgvector.sql`: the pgvector extension, the `document_chunks` table (768-dim embeddings, HNSW + GIN indexes, RLS), document processing status and duplicate hashes, and the `match_document_chunks` hybrid retrieval function. Safe to re-run.

```bash
npm run test:db     # checks tables, migration 002, and the storage bucket
npm run test:groq   # checks the Groq key and model
npm run test:embed  # optional: checks Groq embeddings, only if GROQ_EMBEDDING_MODEL is set
npm run seed        # creates 5 demo auth users + the NovaTech workspace
npm run dev         # http://localhost:3000
```

**Demo logins** all use the password `NovaTech@2026`, or the value of `DEMO_PASSWORD`. The login page has one-click fill buttons.

| User | Email | Role |
|---|---|---|
| Aisha Khan | aisha@novatech.io | Admin |
| Rahul Sharma | rahul@novatech.io | Team Lead |
| Priya Patel | priya@novatech.io | Member |
| Arjun Mehta | arjun@novatech.io | Member |
| Neha Gupta | neha@novatech.io | Viewer |

> The seed **resets only the workspace with slug `novatech`**. Other workspaces are untouched. The seeded data includes:
> - 4 meetings: one that Priya missed, plus 2 upcoming.
> - 3 decisions and 6 tasks. One task is overdue and carried forward, one is blocked and handed over, and one is overdue with no owner.
> - A completed handover.
> - Two real text files stored in Supabase Storage.
> - An activity history.

## 2. Architecture

```
src/
  proxy.ts                 session refresh + redirect to /login (Next 16 "proxy", formerly middleware)
  app/(app)/…              pages (server components read via the user's RLS-bound Supabase client)
  app/api/…                route handlers (Zod validation, role checks, request IDs, logging)
  lib/auth.ts              user + active workspace + role (cookie-selected, multi-workspace)
  lib/rbac.ts              permission matrix (mirrored by RLS)
  lib/api.ts               route() wrapper: auth, permissions, Zod, uniform errors, x-request-id
  lib/tasks.ts             task lifecycle, history events, carry-forward, notifications
  lib/continuity.ts        Context Continuity Engine (deterministic score)
  lib/ai/groq.ts           Groq JSON-mode client: Zod validation, repair retry, latency, audit log
  lib/ai/prompts.ts        5 prompt + schema pairs
  lib/notify/*             provider interface, Telegram provider, preference checks, dedupe
  lib/extract.ts           PDF (unpdf, per page) / DOCX (mammoth) / TXT extraction + magic-byte checks
  lib/rag/chunk.ts         page-aware overlapping chunker
  lib/rag/embeddings.ts    optional Groq embeddings (768-d) for pgvector
  lib/rag/ingest.ts        extract → chunk → embed → store, with status + failure handling
  lib/rag/retrieve.ts      Groq query expansion → match_document_chunks (user session → RLS) → Groq re-rank
  app/api/knowledge/ask    grounded Groq answer with [S#] citations
  lib/logger.ts            Pino → stdout + logs/app.log (rotated at 10 MB, 3 files kept)
supabase/migrations/       schema + RLS
src/scripts/seed.ts        demo data
```

**Security model**
- Every page and API route runs with the **user's session**, so Postgres RLS applies. The API also enforces the role matrix in `lib/rbac.ts`.
- RLS uses `SECURITY DEFINER` helpers (`is_workspace_member`, `can_write`, `is_lead`, `ws_role`) with a pinned `search_path`. All data is isolated per workspace.
- `task_events` and `activity_events` are **append-only**: there are no UPDATE or DELETE policies, so history can't be rewritten.
- Handovers run in one Postgres function (`perform_handover`, `SECURITY INVOKER`). Reassignment, history events and handover items either all commit or none do.
- The service-role key is server-only and used in just four places: writing notifications to other users, the Telegram webhook, the cron job, and creating a new workspace with its first admin.
- Uploaded files go to a private bucket with workspace-scoped storage policies. Downloads use 60-second signed URLs. File type is checked by magic bytes, and the limit is 5 MB.

## 3. AI configuration (Groq)

- Model: `GROQ_MODEL` (default `openai/gpt-oss-120b`). It uses JSON mode, `temperature` 0.2–0.3, a 45 s timeout, and SDK retries on 429/5xx.
- GPT-OSS is a reasoning model. `GROQ_REASONING_EFFORT` (`low`, `medium` or `high`; default `medium`) sets how hard it thinks. Reasoning is excluded from the response (`include_reasoning: false`), and the completion budget is raised to 8192 tokens. Any non-reasoning Groq model, e.g. `llama-3.3-70b-versatile`, also works by changing `GROQ_MODEL`.
- Every response is **validated with Zod**. If validation fails, the model gets one automatic "repair" retry with the validation errors. Failures never throw; the user's notes and tasks are untouched and the UI shows a friendly message.
- Every call, success or failure, is stored in `ai_generations` with the model, tokens, latency, input/output and parsed JSON.
- Hallucination guards:
  - Owners must match real workspace member IDs. Otherwise they're matched by an unambiguous name, else set to `null`.
  - Deadlines are validated, and invented task, meeting or document IDs are filtered out.
  - Extracted tasks are **never saved automatically**. A lead reviews and edits them, then clicks "Approve & save".
  - Approval is duplicate-safe (unique on meeting + title).

| Service | Endpoint |
|---|---|
| Meeting recap, decisions, action items | `POST /api/meetings/:id/extract` → review → `POST /api/meetings/:id/apply` |
| Personalized catch-up brief | `POST /api/briefs/catch-up` |
| Handover brief | `POST /api/handovers/preview` |
| Continuity risk analysis | `POST /api/continuity/analyze` |
| Document → task/meeting/decision links (full-text search + Groq) | `POST /api/documents/:id/suggest` |

## 4. Knowledge Base RAG pipeline (Groq only)

The RAG pipeline uses **Groq for every AI step**. No other AI provider is involved.

**Embeddings.** Groq's public model list currently has no embedding model, so by default retrieval doesn't use vectors:

| Step | How |
|---|---|
| 1. Query expansion | Groq (`GROQ_MODEL`, low reasoning effort) turns the question into 6–15 keywords, synonyms and technical terms |
| 2. Candidate retrieval | Postgres full-text search over chunks (English stemming, GIN index) with an OR of the expanded terms. Up to about 24 candidates, scoped by RLS |
| 3. Re-ranking | Groq scores each candidate 0–10 for the question and drops anything under 3 |
| 4. Answer | Groq answers only from the top 8 kept chunks, with `[S#]` citations |

**Optional vectors.** If your Groq account serves an embedding model on its OpenAI-compatible `/embeddings` endpoint, set `GROQ_EMBEDDING_MODEL`. It must produce 768 dimensions; the Groq SDK's typed model is `nomic-embed-text-v1_5`. Run `npm run test:embed` to check, then re-index. The `match_document_chunks` function then fuses pgvector cosine similarity (HNSW) with full-text rank using reciprocal rank fusion. If Groq embeddings fail at any point, indexing and search fall back to full-text automatically; the document shows the reason, and the UI shows which mode was used.

**Ingestion** (`POST /api/documents`, about 60 s max on Vercel):
1. Validate: PDF, DOCX or TXT, ≤5 MB, with the real type checked by magic bytes.
2. Reject duplicates: a file whose SHA-256 already exists in the workspace gets a `409` linking to the existing document.
3. Upload to the private `documents` bucket at `<workspace_id>/<uuid>-<file>`.
4. Insert the document row with `status = processing`. If that insert fails, the uploaded file is removed again.
5. Extract text (PDF per page) and split it into chunks of about 1,200 characters with about 200 characters of overlap. Chunks break on paragraph, then sentence, then word boundaries and keep their page range.
6. If `GROQ_EMBEDDING_MODEL` is set, embed in batches (retrying on 429/5xx). Then replace any existing chunks for the document, so re-indexing never duplicates them.
7. Set the document to `ready` with its chunk count and embedding model.

If any step fails, the document is marked `failed` with the reason, its chunks are removed, and the file stays in Storage. **Re-index** (`POST /api/documents/:id/reindex`) retries from the stored file.

**Deletion** (`DELETE /api/documents/:id`, uploader or lead): deleting the row removes its chunks, embeddings and knowledge links through `ON DELETE CASCADE`. The file is then removed from Storage.

**Retrieval** uses `match_document_chunks`, a `SECURITY INVOKER` SQL function called with the **user's session**. RLS on `document_chunks` and `knowledge_documents`, plus explicit workspace and membership checks, mean a user can only ever retrieve chunks from workspaces they belong to, and only from `ready` documents. Retrieval is full-text, or hybrid when Groq embeddings are enabled, and is always followed by Groq re-ranking. It can be scoped to specific documents.

**Answering** (`POST /api/knowledge/ask`):
- The top 8 re-ranked chunks are sent to Groq as numbered sources (`S1…S8`), each with its document name and page or chunk number.
- The prompt only allows facts from those sources, requires an inline `[S#]` citation on every factual sentence, and makes the model set `insufficient: true` when the context doesn't answer the question.
- Citations to sources that don't exist are removed.
- If nothing relevant is retrieved, or the re-ranker rejects everything, no answer is generated; the API says the knowledge base doesn't cover the question.
- Every answer is logged in `ai_generations` as `kb_answer`.

**UI:**
- **Knowledge Base page:** "Ask the knowledge base" at the top, with clickable `[S#]` citation chips, a source list (document, page or chunk, relevance score, snippet), loading skeletons and error states.
- **Document pages:** index status, chunk count and embedding model, a per-document Q&A, plus **Re-index** and **Delete**.

## 5. Special feature: Context Continuity Engine

The **Context Health Score** is deterministic and explainable. It starts at 100, and each signal subtracts a fixed penalty per task, up to a cap:

| Signal | Penalty | Cap |
|---|---|---|
| Overdue (past due, not done) | 8 | 32 |
| Blocked | 6 | 18 |
| Unassigned open task | 6 | 18 |
| Carried into 2+ meetings | 4 | 12 |
| Due within 48 h and still To Do | 3 | 9 |
| Owner missed the meeting where the task was agreed | 3 | 9 |

A score of 80 or more is healthy, 55–79 is moderate, and below 55 is critical. The `/continuity` page shows:
- Each component: its count, penalty and reason.
- The at-risk tasks.
- **Suggestions for the next meeting**: unresolved at-risk tasks not yet on that meeting's agenda. You can add them in one click; they keep their original task ID and history.
- An **AI risk analysis**: Groq explains the drivers and recommends who should do what. It can't change the score.
- A 30-day **decision and task timeline**.

Each task page also shows its complete timeline: source meeting, decisions, status changes, reassignments, handovers, carry-forwards, linked documents and the closing outcome.

## 6. Telegram notifications

1. Create a bot with @BotFather, then set `TELEGRAM_BOT_TOKEN`.
2. **Linking:** on Notifications → Connect Telegram, the app issues a single-use token. It's valid for 15 minutes and only its SHA-256 hash is stored. You open `t.me/<bot>?start=<token>` and press Start, and that attaches your chat ID. A user can never enter someone else's chat ID.
   - **Local dev:** click "I pressed Start". The server polls `getUpdates` and matches only your own token.
   - **Production:** register the webhook. Telegram then sends the secret header and linking completes automatically.
     ```bash
     curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
       -d url=https://YOUR-APP.vercel.app/api/telegram/webhook -d secret_token=$TELEGRAM_WEBHOOK_SECRET
     ```
3. **What triggers a notification.** The person who caused the event is never notified. Every send is checked against the recipient's preferences and stored in `notifications` with its status: `delivered`, `failed` (with the error), or `in_app` if Telegram isn't linked. A unique `dedupe_key` blocks duplicates.

| Event | Who is notified | When |
|---|---|---|
| Meeting scheduled | All invited participants | Meeting created |
| Added to meeting | Newly added participant | Meeting edited |
| Meeting rescheduled | All participants | Date changed |
| Meeting starting soon | All participants | Reminder run, meeting within 24 h |
| Task assigned | New owner | Task created (incl. AI-approved tasks) |
| Task reassigned | New owner | Owner changed |
| Added to agenda | Task owner | Task carried into a meeting |
| Task completed / blocked | Task creator | Status changed to Done or Blocked |
| Handover completed | Incoming owner | Handover confirmed |
| Deadline approaching | Task owner | Reminder run, due within 36 h (once per due date) |
| Task overdue | Task owner | Reminder run (at most once per day) |

4. **Reminder runs.** `GET /api/cron/deadlines` with `Authorization: Bearer $CRON_SECRET` runs every morning at 09:00 IST via `vercel.json`; Vercel sends that header automatically. Leads and admins can also click **Notifications → Send due reminders now**. Both are idempotent. To test locally:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/deadlines
   ```
5. **Demo shortcut: one phone for everyone.** Bots can't message a phone number directly, so this script links all NovaTech users to one Telegram chat after verifying its number:
   ```bash
   npm run demo:telegram -- 9420870505
   ```
   On that phone, open the bot link the script prints, press **Start**, then tap **Share my phone number**. The script only links if the shared number matches and is the sender's own contact. After that, every assignment, reassignment, meeting, handover and deadline notification for any demo user arrives in that chat, and each one is still recorded per user in the notification history. It needs no webhook set; run it locally.
6. WhatsApp is optional and **not implemented**. `NotificationProvider` in `lib/notify/types.ts` is the extension point, and it needs opt-in plus Meta-approved message templates.

## 7. Logging

Pino writes structured JSON. Each log line carries:
- `requestId`, which is also returned in the `x-request-id` header.
- `userId`, `workspaceId`, `role`, `method`, `path`, `status` and `durationMs`.

It also logs these events:
- Meeting, task, assignment, reassignment, closure and handover events.
- AI latency and token counts, validation failures and errors.
- Notification delivery attempts and their outcomes.

- **Local:** stdout plus `logs/app.log`, rotated at **10 MB** (`app.log.1`–`.3` kept, so 40 MB max). Set the level with `LOG_LEVEL`.
- **Production (Vercel):** the filesystem is ephemeral and read-only, so the file sink turns itself off and logs go to stdout. Use a **Vercel Log Drain** (Axiom, Better Stack, Datadog…) for persistence and search.

## 8. Deploy (GitHub → Vercel)

```bash
# 1. Push to GitHub (.env.local, node_modules, .next and logs are git-ignored)
git add -A
git status                      # make sure .env.local is NOT listed
git commit -m "ContextFlow AI"
gh repo create contextflow --private --source=. --push
#   or: create an empty repo on github.com, then
#   git remote add origin https://github.com/<you>/contextflow.git && git push -u origin main
```

2. **Vercel** → Add New Project → import the repo. The framework is detected as Next.js and needs no build settings.
3. **Environment variables** (Project → Settings → Environment Variables): copy them from `.env.local`.
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - `GROQ_API_KEY`, `GROQ_MODEL`, and optionally `GROQ_REASONING_EFFORT` and `GROQ_EMBEDDING_MODEL`
   - `TELEGRAM_BOT_TOKEN`, `CRON_SECRET` (any long random string)
   - `NEXT_PUBLIC_APP_URL` = your Vercel URL, e.g. `https://contextflow.vercel.app`. Telegram messages then link back to the app.

   Only the two Supabase URL/anon keys may have the `NEXT_PUBLIC_` prefix.
4. **Deploy.** Then in Supabase → Authentication → URL Configuration, set the Site URL and redirect URLs to the Vercel URL.
5. **Cron:** `vercel.json` registers the daily reminder job automatically. Vercel Hobby allows daily crons; use "Send due reminders now" for on-demand runs.
6. **Telegram:** no webhook is needed. Account linking ("I pressed Start") and `npm run demo:telegram` both use `getUpdates`, which works on Vercel. Only register the webhook (§6) if you want fully automatic linking, and note that once a webhook is set, `getUpdates`-based linking stops working.
7. Logs go to Vercel's runtime logs (stdout JSON). Add a Log Drain for persistence (§7).

### Deploying on Render instead

`render.yaml` (Blueprint) and `.node-version` are included.

1. Push to GitHub (same commands as above).
2. Render → **New → Blueprint** → pick the repo. Alternatively, create a **Web Service** with:
   - Runtime: Node
   - Build command: `npm ci --no-audit --no-fund && npm run build`
   - Start command: `npm run start`
   - Env vars: `NODE_VERSION=22` and `LOG_TO_FILE=false`
3. Fill in the secrets when prompted: Supabase URL, anon key, service role key, `GROQ_API_KEY`, `TELEGRAM_BOT_TOKEN`, and `NEXT_PUBLIC_APP_URL=https://<service>.onrender.com`. `CRON_SECRET` is generated for you.
   `NEXT_PUBLIC_*` values are baked in at build time; if you change them, trigger a new deploy.
4. In Supabase → Authentication → URL Configuration, set the Site URL to the Render URL.
5. **Reminders:** `vercel.json` crons don't run on Render. Use the included GitHub Action (`.github/workflows/reminders.yml`, daily at 09:00 IST, plus a manual "Run workflow" button). Add the repo secrets `APP_URL` and `CRON_SECRET`, using the value Render generated. Or use **Notifications → Send due reminders now**.
6. **Free plan:** the service sleeps after 15 minutes idle, and the first request then takes 30–60 s. Open the app a minute before a demo, or use the Starter plan.

## 9. End-to-end demo checklist

| # | Step | Where |
|---|---|---|
| 1 | Rahul logs in and creates a meeting with participants (they get notified) | Meetings → New meeting |
| 2 | Rahul adds raw notes, ticks attendance (leave Priya unticked) and marks it completed | Meeting page |
| 3 | AI recap: "Extract with AI" | Meeting page |
| 4 | Rahul edits owners and dates, then clicks Approve & save | Review panel |
| 5 | Tasks are saved with owners and deadlines | Action Items |
| 6 | Arjun gets a Telegram message for his task (after he connects Telegram) | Notifications → history shows delivery status |
| 7 | Priya generates her catch-up brief for the meeting she missed | Dashboard banner / AI Briefs |
| 8 | Arjun hands over an unfinished task to Priya with an AI brief | Handovers → New handover |
| 9 | The reassignment history is kept | Task page → Complete history |
| 10 | Rahul carries the task into the next meeting | Meeting page → Carry forward, or Continuity → Suggested |
| 11 | The Continuity Engine highlights risks | Continuity → Analyse risks |
| 12 | Priya closes the task with an outcome (required) | Task page → Close with outcome |
| 13 | The complete history is still accessible | Task page timeline, Activity |

## 10. Assumptions & known limitations

- **Not yet verified against live services from the build environment.** The app compiles, type-checks (`npm run typecheck`) and builds (`npm run build`) cleanly. Auth gating, logging and PDF/DOCX extraction were smoke-tested. The Supabase, Groq and Telegram calls need your credentials. Run `npm run test:db`, `npm run test:groq`, then the checklist above.
- RLS permissions are coarser (member/writer/lead/admin) than the API's rules. For example, "members may only update their own tasks" is enforced in the API layer.
- Groq-only RAG relies on full-text search plus Groq query expansion and re-ranking. That's strong for runbook- and policy-style documents, but weaker than vectors for paraphrased questions that share no words with the source. Enable `GROQ_EMBEDDING_MODEL` if your account supports it. Each question makes 3 Groq calls (expand, re-rank, answer). Scanned PDFs have no OCR, so they're marked `failed` ("no extractable text").
- Indexing runs inline in the upload request, which keeps it simple and fits Vercel's 60 s limit for 5 MB files. There's no background queue. Very large PDFs (200k+ characters) are truncated for indexing.
- Retrieval filters by workspace before ranking. For very large workspaces, a partitioned pre-filter would be faster.
- UI components are hand-written in the shadcn/ui style (cva + Tailwind) rather than generated with the shadcn CLI and Radix, to keep dependencies small.
- Notifications are sent inline during the request, with a 10 s Telegram timeout. There's no retry queue; failed sends are recorded with their error.
- WhatsApp is not implemented. There are no email notifications. Vercel Hobby limits the cron to once a day.
- No automated test suite yet. The scripts in `src/scripts` and the checklist above serve as verification.
