import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger, type Logger } from '@/lib/logger';
import { env } from '@/lib/env';
import { telegramProvider } from './telegram';
import { PREF_COLUMN, type NotificationEvent, type NotificationProvider } from './types';

const PROVIDERS: Record<string, NotificationProvider> = { telegram: telegramProvider };

export interface NotifyInput {
  workspaceId: string;
  userId: string;
  event: NotificationEvent;
  title: string;
  message: string;
  targetType?: string;
  targetId?: string;
  /** Path inside the app, e.g. /tasks/<id> */
  linkPath?: string;
  /** Same key = same notification; duplicates are skipped (DB unique index). */
  dedupeKey?: string;
  /** Skip notifying the person who caused the event. */
  actorId?: string;
}

export type NotifyOutcome = 'delivered' | 'failed' | 'skipped_duplicate' | 'skipped_self' | 'skipped_pref' | 'in_app';

/**
 * Records a notification and delivers it on the user's verified channel (Telegram).
 * If the user has no verified channel, it's stored as an in-app notification.
 * Never throws — notification failures must not break the user's action.
 */
export async function notify(input: NotifyInput, log: Logger = logger): Promise<NotifyOutcome> {
  const l = log.child({ notify: input.event, recipient: input.userId, dedupeKey: input.dedupeKey });
  try {
    if (input.actorId && input.actorId === input.userId && input.event !== 'test') return 'skipped_self';
    const db = supabaseAdmin();

    const [{ data: pref }, { data: conn }] = await Promise.all([
      db.from('notification_preferences').select('*').eq('user_id', input.userId).eq('channel', 'telegram').maybeSingle(),
      db.from('notification_connections').select('destination_id,is_verified').eq('user_id', input.userId).eq('channel', 'telegram').maybeSingle(),
    ]);
    if (input.event !== 'test' && pref && pref[PREF_COLUMN[input.event]] === false) {
      l.debug('notification disabled by preference');
      return 'skipped_pref';
    }

    const channel = conn?.is_verified && conn.destination_id ? 'telegram' : 'in_app';
    const { data: row, error } = await db
      .from('notifications')
      .insert({
        workspace_id: input.workspaceId,
        user_id: input.userId,
        channel,
        title: input.title,
        message: input.message,
        event_type: input.event,
        target_type: input.targetType ?? null,
        target_id: input.targetId ?? null,
        status: channel === 'in_app' ? 'delivered' : 'pending',
        sent_at: channel === 'in_app' ? new Date().toISOString() : null,
        dedupe_key: input.dedupeKey ?? null,
      })
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505') {
        l.info('duplicate notification skipped');
        return 'skipped_duplicate';
      }
      l.error({ error: error.message }, 'could not store notification');
      return 'failed';
    }
    if (channel === 'in_app') {
      l.info('stored in-app notification (no verified Telegram connection)');
      return 'in_app';
    }

    const link = input.linkPath ? `${env.appUrl()}${input.linkPath}` : undefined;
    const started = Date.now();
    const result = await PROVIDERS.telegram.send(conn!.destination_id!, input.title, input.message, link?.startsWith('http://localhost') ? undefined : link);
    await db
      .from('notifications')
      .update({
        status: result.ok ? 'delivered' : 'failed',
        error_message: result.ok ? null : result.error?.slice(0, 500),
        sent_at: result.ok ? new Date().toISOString() : null,
        attempts: 1,
      })
      .eq('id', row.id);
    l[result.ok ? 'info' : 'warn']({ channel, latencyMs: Date.now() - started, ok: result.ok, error: result.error }, 'notification delivery attempt');
    return result.ok ? 'delivered' : 'failed';
  } catch (e) {
    l.error({ err: (e as Error).message }, 'notify crashed');
    return 'failed';
  }
}
