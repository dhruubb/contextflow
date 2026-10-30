'use client';

export class ClientApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

/** fetch wrapper for our JSON API: throws ClientApiError with the server's message. */
export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'),
    headers: opts.form ? undefined : { 'content-type': 'application/json' },
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = json.details as { path: string; message: string }[] | undefined;
    const detailText = Array.isArray(details) && details.length ? ` (${details.map((d) => `${d.path}: ${d.message}`).join('; ')})` : '';
    throw new ClientApiError((json.error || `Request failed (${res.status})`) + detailText, res.status, details);
  }
  return json as T;
}
