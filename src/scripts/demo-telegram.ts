/**
 * DEMO ONLY: route every member of the NovaTech demo workspace to ONE Telegram chat,
 * identified by a phone number, so all notifications show up on a single demo phone.
 *
 * Telegram bots cannot message a phone number directly — the phone's owner must press Start
 * and share their contact. This script verifies the shared number matches (and that it is the
 * sender's own contact), then links all demo users to that chat.
 *
 * Usage:  npm run demo:telegram -- 9420870505
 * (Run locally without a webhook set; it uses getUpdates long-polling for up to 3 minutes.)
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const phoneArg = process.argv[2] || process.env.DEMO_TELEGRAM_PHONE;
const WORKSPACE_SLUG = process.env.DEMO_WORKSPACE_SLUG || 'novatech';

if (!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN missing in .env.local');
if (!phoneArg) throw new Error('Pass the phone number: npm run demo:telegram -- 9420870505');
const last10 = (p: string) => p.replace(/\D/g, '').slice(-10);
const TARGET = last10(phoneArg);
if (TARGET.length !== 10) throw new Error(`"${phoneArg}" does not look like a 10-digit phone number`);

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function tg<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!json.ok) throw new Error(`${method}: ${json.description}`);
  return json.result;
}

interface Update {
  update_id: number;
  message?: {
    chat: { id: number };
    from?: { id: number; username?: string; first_name?: string };
    text?: string;
    contact?: { phone_number: string; user_id?: number };
  };
}

async function linkAll(chatId: number, username: string | undefined) {
  const { data: ws } = await db.from('workspaces').select('id,name').eq('slug', WORKSPACE_SLUG).maybeSingle();
  if (!ws) throw new Error(`Workspace "${WORKSPACE_SLUG}" not found — run npm run seed first`);
  const { data: members } = await db.from('workspace_members').select('user_id, profile:profiles(full_name)').eq('workspace_id', ws.id);
  const rows = (members ?? []).map((m) => ({
    user_id: m.user_id,
    channel: 'telegram',
    destination_id: String(chatId),
    is_verified: true,
    verified_at: new Date().toISOString(),
    verification_token: null,
    token_expires_at: null,
    telegram_username: username ?? null,
  }));
  const { error } = await db.from('notification_connections').upsert(rows, { onConflict: 'user_id,channel' });
  if (error) throw new Error(`Linking failed: ${error.message}`);
  await db.from('notification_preferences').upsert(rows.map((r) => ({ user_id: r.user_id, channel: 'telegram' })), { onConflict: 'user_id,channel', ignoreDuplicates: true });

  const names = (members ?? []).map((m) => (m.profile as unknown as { full_name: string } | null)?.full_name).filter(Boolean).join(', ');
  await tg('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text: `✅ <b>ContextFlow demo connected</b>\nNotifications for all ${rows.length} ${ws.name} users (${names}) will arrive in this chat.`,
    reply_markup: { remove_keyboard: true },
  });
  console.log(`\n✓ Linked ${rows.length} users (${names}) to chat ${chatId}${username ? ` (@${username})` : ''}.`);
}

async function main() {
  const me = await tg<{ username: string }>('getMe');
  console.log(`Bot: @${me.username}`);
  console.log(`\nOn the phone with number ${TARGET}:`);
  console.log(`  1. Open https://t.me/${me.username} and press Start`);
  console.log(`  2. Tap "📱 Share my phone number" when the bot asks\n`);
  console.log('Waiting up to 3 minutes…');

  let offset = 0;
  const deadline = Date.now() + 3 * 60_000;
  while (Date.now() < deadline) {
    let updates: Update[];
    try {
      updates = await tg<Update[]>('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
    } catch (e) {
      const msg = (e as Error).message;
      if (/webhook/i.test(msg)) throw new Error('A webhook is set on this bot. Remove it for the demo: curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/deleteWebhook"');
      throw e;
    }
    for (const u of updates) {
      offset = u.update_id + 1;
      const m = u.message;
      if (!m) continue;
      if (m.contact) {
        const own = m.contact.user_id && m.from && m.contact.user_id === m.from.id;
        if (!own) {
          await tg('sendMessage', { chat_id: m.chat.id, text: 'Please share your own number using the button.' });
          continue;
        }
        if (last10(m.contact.phone_number) !== TARGET) {
          console.log(`  ✗ ${m.from?.first_name ?? 'someone'} shared a different number — ignored`);
          await tg('sendMessage', { chat_id: m.chat.id, text: 'This number is not the configured demo number.', reply_markup: { remove_keyboard: true } });
          continue;
        }
        await linkAll(m.chat.id, m.from?.username);
        await tg('getUpdates', { offset, timeout: 0 }); // acknowledge processed updates
        return;
      }
      if (m.text?.startsWith('/start')) {
        console.log(`  … ${m.from?.first_name ?? 'someone'} pressed Start — asking for their number`);
        await tg('sendMessage', {
          chat_id: m.chat.id,
          text: 'To receive ContextFlow demo notifications here, confirm your phone number:',
          reply_markup: { keyboard: [[{ text: '📱 Share my phone number', request_contact: true }]], one_time_keyboard: true, resize_keyboard: true },
        });
      }
    }
  }
  console.log('\nTimed out. Run the command again and press Start on the phone.');
  process.exit(1);
}

main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
