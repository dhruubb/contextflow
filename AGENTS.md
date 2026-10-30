# ContextFlow AI — Agent guide

## Stack
Next.js 16 App Router (TypeScript 7, Turbopack, `src/proxy.ts` instead of middleware) · Tailwind 3 + hand-written shadcn-style UI (`src/components/ui`) · Supabase (Auth, Postgres RLS, Storage) · Groq (`groq-sdk`, default model `openai/gpt-oss-120b`) · Telegram Bot API · Pino · Zod 4.

## Commands
`npm run dev` · `npm run build` · `npm run typecheck` · `npm run seed` · `npm run test:db` · `npm run test:groq`

## Conventions
- **Pages** (`src/app/(app)/**/page.tsx`) are server components that call `requireContext()` and query with `ctx.supabase`, the user's session client, so RLS applies. Interactive parts live in sibling `*-client.tsx` files.
- **API routes** always use `route({ body, permission }, handler)` from `lib/api.ts`. That wrapper handles auth, role checks, Zod validation, request IDs, logging and errors. Use `check()` / `dbError()` for Supabase results.
- **Permissions:** coarse rules are in `lib/rbac.ts`, mirrored by RLS in migration 002. Finer rules go in the handlers or in `lib/tasks.ts`.
- **Task changes** go through `lib/tasks.ts` (`createTask`, `updateTask`, `carryForward`), so history events, activity and notifications stay consistent. Never update `action_items` directly from a route.
- **AI calls** go through `generateJSON()` in `lib/ai/groq.ts`, with a Zod schema from `lib/ai/prompts.ts`. Filter any IDs the model returns against the candidates you sent. Never persist AI tasks without human approval.
- **RAG**: ingestion goes through `lib/rag/ingest.ts`; retrieval must go through `retrieveChunks()` (user session → RLS) before any text reaches the LLM. `lib/rag/chunk.ts` and `lib/rag/embeddings.ts` have no `server-only` import, because the seed script uses them. RAG is **Groq-only**: query expansion → full-text → Groq re-rank → Groq answer. Groq embeddings (768-d) are optional via `GROQ_EMBEDDING_MODEL`.
- **Notifications** go through `notify()` in `lib/notify`. Always pass a `dedupeKey`.
- `supabaseAdmin()` (service role) is used only for notifications, the webhook, the cron job and workspace bootstrap.
- Zod: use `zId` (`z.guid()`) for IDs, not `z.uuid()`.
- Supabase embeds on an untyped client: cast with `as unknown as T`. Name FK embeds explicitly, e.g. `profiles!action_items_assignee_id_fkey`.
- Never commit `.env.local`. Update PROGRESS.md after each change set.
