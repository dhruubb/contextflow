import 'server-only';
import { env } from '@/lib/env';
import type { NotificationProvider } from './types';

const API = 'https://api.telegram.org';

export function telegramConfigured() {
  return Boolean(env.telegramToken());
}

async function call<T>(method: string, body?: Record<string, unknown>): Promise<T> {
  const token = env.telegramToken();
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!res.ok || !json.ok) throw new Error(json.description || `Telegram ${method} failed (${res.status})`);
  return json.result as T;
}

let botUsername: string | null = null;
export async function getBotUsername(): Promise<string> {
  if (process.env.TELEGRAM_BOT_USERNAME) return process.env.TELEGRAM_BOT_USERNAME;
  if (!botUsername) botUsername = (await call<{ username: string }>('getMe')).username;
  return botUsername;
}

export interface TelegramUpdate {
  update_id: number;
  message?: { text?: string; chat: { id: number }; from?: { username?: string; first_name?: string } };
}

export async function getUpdates(): Promise<TelegramUpdate[]> {
  return call<TelegramUpdate[]>('getUpdates', { allowed_updates: ['message'], timeout: 0 });
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function sendTelegram(chatId: string, html: string) {
  return call<{ message_id: number }>('sendMessage', {
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  });
}

export const telegramProvider: NotificationProvider = {
  channel: 'telegram',
  async send(destination, title, message, link) {
    try {
      const text = `<b>${escapeHtml(title)}</b>\n${escapeHtml(message)}${link ? `\n\n<a href="${link}">Open in ContextFlow</a>` : ''}`;
      const r = await sendTelegram(destination, text);
      return { ok: true, providerMessageId: String(r.message_id) };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },
};
