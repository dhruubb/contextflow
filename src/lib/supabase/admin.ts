import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

/**
 * Service-role client. BYPASSES RLS — server-only, and only used for:
 *  - writing notification rows for other users (recipients can only read their own)
 *  - the Telegram webhook and the cron endpoint (no user session)
 *  - creating a new workspace + its first admin membership
 * Every caller performs its own authorization first.
 */
let client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl(), env.serviceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
