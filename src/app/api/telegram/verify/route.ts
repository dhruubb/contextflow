import { route, ApiError } from '@/lib/api';
import { getUpdates } from '@/lib/notify/telegram';
import { completeTelegramLink } from '@/lib/telegram-link';

/**
 * Local-development fallback when no public webhook is configured:
 * polls getUpdates for this user's "/start <token>" message. Only matches the caller's own token hash.
 */
export const POST = route({ permission: 'notifications.self' }, async ({ ctx, log }) => {
  let updates;
  try {
    updates = await getUpdates();
  } catch (e) {
    const msg = (e as Error).message;
    if (/webhook/i.test(msg)) return { linked: false, message: 'A webhook is active, so linking completes automatically. Refresh this page in a few seconds.' };
    throw new ApiError(502, `Telegram error: ${msg}`);
  }
  for (const u of updates.slice().reverse()) {
    const text = u.message?.text;
    if (!text?.startsWith('/start')) continue;
    const userId = await completeTelegramLink(text, u.message!.chat.id, u.message!.from?.username, log, ctx.user.id);
    if (userId) return { linked: true };
  }
  return { linked: false, message: 'No /start message found yet. Open the link, press Start in Telegram, then check again.' };
});
