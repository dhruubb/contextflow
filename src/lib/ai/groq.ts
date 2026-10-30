import 'server-only';
import Groq from 'groq-sdk';
import type { ZodType, z } from 'zod';
import { env } from '@/lib/env';
import { logger, type Logger } from '@/lib/logger';
import type { AppContext } from '@/lib/auth';

export type GenerationType =
  | 'meeting_summary'
  | 'action_items_extract'
  | 'catch_up_brief'
  | 'handover_context'
  | 'continuity_risk'
  | 'doc_linking'
  | 'kb_answer';

let groq: Groq | null = null;
function client() {
  if (!groq) groq = new Groq({ apiKey: env.groqKey(), timeout: 45_000, maxRetries: 2 });
  return groq;
}

export type AIResult<T> =
  | { ok: true; data: T; generationId: string | null; latencyMs: number; model: string }
  | { ok: false; error: string; generationId: string | null };

interface Args<S extends ZodType> {
  ctx: AppContext;
  type: GenerationType;
  schema: S;
  system: string;
  user: string;
  target?: { type: string; id: string };
  log?: Logger;
  temperature?: number;
  /** Skip writing an ai_generations row (for small helper calls like query expansion / re-ranking). */
  record?: boolean;
  /** Override reasoning effort for gpt-oss models. */
  reasoningEffort?: 'low' | 'medium' | 'high';
}

function friendly(err: unknown): string {
  const e = err as { status?: number; message?: string; name?: string };
  if (e?.status === 429) return 'The AI service is rate-limited right now. Please retry in a minute — nothing was lost.';
  if (e?.status === 401) return 'The Groq API key is invalid or missing (GROQ_API_KEY).';
  if (e?.name === 'APIConnectionTimeoutError' || /timed? ?out/i.test(e?.message ?? '')) return 'The AI request timed out. Please retry — your data is saved.';
  if (/Missing environment variable/.test(e?.message ?? '')) return e.message!;
  return 'The AI service failed to respond. Your data is saved; please retry.';
}

/**
 * Calls Groq in JSON mode, validates the response with Zod (one automatic repair attempt),
 * logs latency, and records every call (success or failure) in ai_generations.
 * Never throws: callers get { ok:false, error } and keep the user's data intact.
 */
export async function generateJSON<S extends ZodType>(args: Args<S>): Promise<AIResult<z.infer<S>>> {
  const log = (args.log ?? logger).child({ ai: args.type });
  const model = env.groqModel();
  const started = Date.now();
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    {
      role: 'system',
      content:
        args.system +
        '\n\nRespond with a single JSON object only. Never invent people, owners, dates or facts that are not in the input; use null when unsure.',
    },
    { role: 'user', content: args.user },
  ];

  let raw = '';
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
  let lastError = '';

  // GPT-OSS models reason before answering: keep reasoning out of the response body and
  // leave room for reasoning tokens in the completion budget.
  const reasoning = model.startsWith('openai/gpt-oss')
    ? { reasoning_effort: args.reasoningEffort ?? env.groqReasoningEffort(), include_reasoning: false, max_completion_tokens: 8192 }
    : { max_completion_tokens: 2048 };

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await client().chat.completions.create({
        model,
        messages,
        temperature: args.temperature ?? 0.2,
        response_format: { type: 'json_object' },
        ...reasoning,
      });
      raw = res.choices[0]?.message?.content ?? '';
      usage = res.usage ?? undefined;
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        lastError = 'Model returned malformed JSON';
        messages.push({ role: 'assistant', content: raw }, { role: 'user', content: 'That was not valid JSON. Return only the corrected JSON object.' });
        continue;
      }
      const parsed = args.schema.safeParse(json);
      if (parsed.success) {
        const latencyMs = Date.now() - started;
        log.info({ model, latencyMs, attempt, promptTokens: usage?.prompt_tokens, completionTokens: usage?.completion_tokens }, 'ai generation succeeded');
        const generationId = await record(args, { model, raw, parsed: parsed.data, latencyMs, usage, status: 'success' }, log);
        return { ok: true, data: parsed.data, generationId, latencyMs, model };
      }
      lastError = 'Model response did not match the expected structure';
      const issues = parsed.error.issues.slice(0, 8).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      log.warn({ attempt, issues }, 'ai response failed validation');
      messages.push({ role: 'assistant', content: raw }, { role: 'user', content: `The JSON did not match the required schema (${issues}). Return the corrected JSON object only.` });
    } catch (err) {
      const latencyMs = Date.now() - started;
      const message = friendly(err);
      log.error({ model, latencyMs, err: (err as Error)?.message, status: (err as { status?: number })?.status }, 'ai generation failed');
      const generationId = await record(args, { model, raw, latencyMs, usage, status: 'failed', error: message }, log);
      return { ok: false, error: message, generationId };
    }
  }

  const latencyMs = Date.now() - started;
  log.error({ model, latencyMs, error: lastError }, 'ai generation invalid after repair');
  const generationId = await record(args, { model, raw, latencyMs, usage, status: 'failed', error: lastError }, log);
  return { ok: false, error: `${lastError}. Please retry.`, generationId };
}

async function record(
  args: Args<ZodType>,
  r: { model: string; raw: string; parsed?: unknown; latencyMs: number; usage?: { prompt_tokens?: number; completion_tokens?: number }; status: 'success' | 'failed'; error?: string },
  log: Logger,
): Promise<string | null> {
  if (args.record === false) return null;
  const { data, error } = await args.ctx.supabase
    .from('ai_generations')
    .insert({
      workspace_id: args.ctx.workspace.id,
      generation_type: args.type,
      model: r.model,
      prompt_tokens: r.usage?.prompt_tokens ?? null,
      completion_tokens: r.usage?.completion_tokens ?? null,
      latency_ms: r.latencyMs,
      raw_input: args.user.slice(0, 20_000),
      raw_output: r.raw.slice(0, 20_000),
      parsed_output: r.parsed ?? null,
      created_by: args.ctx.user.id,
      target_type: args.target?.type ?? null,
      target_id: args.target?.id ?? null,
      status: r.status,
      error_message: r.error ?? null,
    })
    .select('id')
    .single();
  if (error) {
    log.warn({ error: error.message }, 'could not record ai generation');
    return null;
  }
  return data.id as string;
}
