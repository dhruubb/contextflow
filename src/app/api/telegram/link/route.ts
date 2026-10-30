import { randomBytes } from 'node:crypto';
import { route, ApiError, check } from '@/lib/api';
import { getBotUsername, telegramConfigured } from '@/lib/notify/telegram';
import { hashToken } from '@/lib/telegram-link';

/** Creates a one-time deep link (t.me/<bot>?start=<token>) for the signed-in user. */
export const POST = route({ permission: 'notifications.self' }, async ({ ctx, log }) => {
  if (!telegramConfigured()) throw new ApiError(503, 'Telegram is not configured on the server (TELEGRAM_BOT_TOKEN)');
  let username: string;
  try {
    username = await getBotUsername();
  } catch (e) {
    throw new ApiError(502, `Could not reach Telegram: ${(e as Error).message}`);
  }
  const token = randomBytes(16).toString('hex');
  check(
    await ctx.supabase.from('notification_connections').upsert(
      {
        user_id: ctx.user.id,
        channel: 'telegram',
        verification_token: hashToken(token),
        token_expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        is_verified: false,
        destination_id: null,
        verified_at: null,
      },
      { onConflict: 'user_id,channel' },
    ),
    'creating link token',
  );
  log.info('telegram link token issued');
  return { url: `https://t.me/${username}?start=${token}`, bot: username, expiresInMinutes: 15 };
});

export const DELETE = route({ permission: 'notifications.self' }, async ({ ctx, log }) => {
  check(await ctx.supabase.from('notification_connections').delete().eq('user_id', ctx.user.id).eq('channel', 'telegram'), 'unlinking telegram');
  log.info('telegram unlinked');
  return { ok: true };
});
