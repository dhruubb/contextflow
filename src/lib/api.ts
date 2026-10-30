import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z, type ZodType } from 'zod';
import { getContext, type AppContext } from '@/lib/auth';
import { can, type Permission } from '@/lib/rbac';
import { requestLogger, type Logger } from '@/lib/logger';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const forbidden = (msg = 'You do not have permission to do this') => new ApiError(403, msg);
export const notFound = (what = 'Resource') => new ApiError(404, `${what} not found`);
export const badRequest = (msg: string, details?: unknown) => new ApiError(400, msg, details);

type RouteParams = { params: Promise<Record<string, string>> };

interface Options<S extends ZodType | undefined> {
  /** Zod schema for the JSON body (POST/PATCH/PUT). */
  body?: S;
  /** Coarse role permission required. */
  permission?: Permission;
  /** Set false for public endpoints (webhooks, cron) that do their own auth. */
  auth?: boolean;
  /** Read multipart form data instead of JSON. */
  formData?: boolean;
}

interface HandlerArgs<B> {
  req: NextRequest;
  ctx: AppContext;
  body: B;
  form: FormData | null;
  params: Record<string, string>;
  log: Logger;
  requestId: string;
}

type Infer<S> = S extends ZodType ? z.infer<S> : undefined;

/**
 * Wraps a route handler with: request IDs, structured logging, auth + workspace resolution,
 * role checks, Zod validation and uniform JSON error responses.
 */
export function route<S extends ZodType | undefined = undefined>(
  opts: Options<S>,
  handler: (args: HandlerArgs<Infer<S>>) => Promise<unknown>,
) {
  return async (req: NextRequest, { params }: RouteParams) => {
    const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
    const started = Date.now();
    let log = requestLogger(requestId, { method: req.method, path: req.nextUrl.pathname });
    try {
      let ctx: AppContext | null = null;
      if (opts.auth !== false) {
        ctx = await getContext();
        if (!ctx) throw new ApiError(401, 'Not signed in');
        if (!ctx.workspace.id) throw new ApiError(403, 'No workspace membership');
        log = log.child({ userId: ctx.user.id, workspaceId: ctx.workspace.id, role: ctx.role });
        if (opts.permission && !can(ctx.role, opts.permission)) throw forbidden();
      }

      let body: unknown = undefined;
      let form: FormData | null = null;
      if (opts.formData) {
        form = await req.formData();
      } else if (opts.body) {
        let json: unknown;
        try {
          json = await req.json();
        } catch {
          throw badRequest('Request body must be valid JSON');
        }
        const parsed = opts.body.safeParse(json);
        if (!parsed.success) {
          throw badRequest('Validation failed', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
        }
        body = parsed.data;
      }

      const result = await handler({
        req,
        ctx: ctx as AppContext,
        body: body as Infer<S>,
        form,
        params: await params,
        log,
        requestId,
      });
      const res = result instanceof Response ? result : NextResponse.json(result ?? { ok: true });
      res.headers.set('x-request-id', requestId);
      log.info({ status: res.status, durationMs: Date.now() - started }, 'request completed');
      return res;
    } catch (err) {
      const durationMs = Date.now() - started;
      if (err instanceof ApiError) {
        log.warn({ status: err.status, durationMs, error: err.message, details: err.details }, 'request rejected');
        return NextResponse.json({ error: err.message, details: err.details, requestId }, { status: err.status, headers: { 'x-request-id': requestId } });
      }
      log.error({ durationMs, err }, 'request failed');
      return NextResponse.json({ error: 'Internal server error', requestId }, { status: 500, headers: { 'x-request-id': requestId } });
    }
  };
}

/** Turns a Supabase/PostgREST error into an ApiError (RLS denials become 403). */
export function dbError(error: { message: string; code?: string } | null, context: string): ApiError | null {
  if (!error) return null;
  if (error.code === '42501' || /row-level security/i.test(error.message)) return new ApiError(403, `Not allowed: ${context}`);
  if (error.code === '23505') return new ApiError(409, `Duplicate: ${context}`);
  if (error.code === 'P0001') return new ApiError(400, error.message);
  return new ApiError(500, `Database error while ${context}: ${error.message}`);
}

export function check<T>(res: { data: T; error: { message: string; code?: string } | null }, context: string): T {
  const e = dbError(res.error, context);
  if (e) throw e;
  return res.data;
}

export const zId = z.guid();
