import type { NextRequest } from 'next/server';
import { route, ApiError } from '@/lib/api';
import { env } from '@/lib/env';
import { safeEqual } from '@/lib/telegram-link';
import { runReminders } from '@/lib/reminders';
import type { Logger } from '@/lib/logger';

export const maxDuration = 60;

/**
 * Scheduled reminders (deadlines, overdue tasks, meetings in the next 24h).
 * Authenticated with `Authorization: Bearer $CRON_SECRET` — Vercel Cron sends it automatically.
 * Idempotent via notification dedupe keys.
 */
async function run(req: NextRequest, log: Logger) {
  const secret = env.cronSecret();
  const auth = req.headers.get('authorization') ?? '';
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) throw new ApiError(401, 'Unauthorized');
  return runReminders(log);
}

export const GET = route({ auth: false }, ({ req, log }) => run(req, log));
export const POST = route({ auth: false }, ({ req, log }) => run(req, log));
