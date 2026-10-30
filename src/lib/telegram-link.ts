import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTelegram } from '@/lib/notify/telegram';
import type { Logger } from '@/lib/logger';

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Completes Telegram linking when the user sends "/start <token>" to the bot.
 * The token is single-use, expires after 15 minutes, and only its hash is stored —
 * so a chat id can only ever be attached by the person holding the one-time link.
 */
export async function completeTelegramLink(text: string, chatId: number, username: string | undefined, log: Logger, onlyUserId?: string) {
  const m = text.trim().match(/^\/start\s+([a-f0-9]{32})$/i);
  if (!m) return null;
  const db = supabaseAdmin();
  let q = db
    .from('notification_connections')
    .select('id,user_id,token_expires_at')
    .eq('channel', 'telegram')
    .eq('verification_token', hashToken(m[1]));
  if (onlyUserId) q = q.eq('user_id', onlyUserId);
  const { data: conn } = await q.maybeSingle();
  if (!conn) return null;
  if (!conn.token_expires_at || new Date(conn.token_expires_at).getTime() < Date.now()) {
    log.warn({ userId: conn.user_id }, 'telegram link token expired');
    return null;
  }
  await db
    .from('notification_connections')
    .update({
      destination_id: String(chatId),
      is_verified: true,
      verified_at: new Date().toISOString(),
      verification_token: null,
      token_expires_at: null,
      telegram_username: username ?? null,
    })
    .eq('id', conn.id);
  log.info({ userId: conn.user_id }, 'telegram account linked');
  try {
    await sendTelegram(String(chatId), '✅ <b>ContextFlow connected.</b>\nYou will receive task, deadline and handover notifications here.');
  } catch (e) {
    log.warn({ err: (e as Error).message }, 'telegram confirmation message failed');
  }
  return conn.user_id as string;
}
