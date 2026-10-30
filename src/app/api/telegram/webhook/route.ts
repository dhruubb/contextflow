import { NextResponse } from 'next/server';
import { route, ApiError } from '@/lib/api';
import { env } from '@/lib/env';
import { completeTelegramLink, safeEqual } from '@/lib/telegram-link';
import type { TelegramUpdate } from '@/lib/notify/telegram';

/**
 * Telegram webhook. Authenticated with the secret_token set via setWebhook
 * (Telegram sends it in X-Telegram-Bot-Api-Secret-Token).
 */
export const POST = route({ auth: false }, async ({ req, log }) => {
  const secret = env.telegramWebhookSecret();
  const got = req.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!secret || !safeEqual(got, secret)) throw new ApiError(401, 'Invalid webhook secret');

  const update = (await req.json().catch(() => null)) as TelegramUpdate | null;
  const text = update?.message?.text;
  if (text?.startsWith('/start') && update?.message) {
    await completeTelegramLink(text, update.message.chat.id, update.message.from?.username, log);
  }
  return NextResponse.json({ ok: true });
});
