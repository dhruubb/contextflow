import { z } from 'zod';
import { NextResponse } from 'next/server';
import { ApiError, route, zId } from '@/lib/api';
import { WORKSPACE_COOKIE } from '@/lib/auth';

export const POST = route({ body: z.object({ workspace_id: zId }) }, async ({ ctx, body }) => {
  if (!ctx.memberships.some((m) => m.workspace_id === body.workspace_id)) throw new ApiError(403, 'Not a member of that workspace');
  const res = NextResponse.json({ ok: true });
  res.cookies.set(WORKSPACE_COOKIE, body.workspace_id, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365 });
  return res;
});
