import { z } from 'zod';
import { route, ApiError } from '@/lib/api';
import { getContext } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

const CreateWsZ = z.object({ name: z.string().trim().min(2).max(80) });

/** Creates a new isolated workspace with the caller as its admin (service role: RLS has no insert path for this bootstrap step). */
export const POST = route({ auth: false, body: CreateWsZ }, async ({ body, log }) => {
  const ctx = await getContext();
  if (!ctx) throw new ApiError(401, 'Not signed in');
  const db = supabaseAdmin();
  const slug = `${body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}-${crypto.randomUUID().slice(0, 6)}`;
  const { data: ws, error } = await db.from('workspaces').insert({ name: body.name, slug }).select('id').single();
  if (error) throw new ApiError(500, error.message);
  const { error: mErr } = await db.from('workspace_members').insert({ workspace_id: ws.id, user_id: ctx.user.id, role: 'admin' });
  if (mErr) throw new ApiError(500, mErr.message);
  await db.from('notification_preferences').upsert({ user_id: ctx.user.id, channel: 'telegram' }, { onConflict: 'user_id,channel' });
  log.info({ workspaceId: ws.id, userId: ctx.user.id }, 'workspace created');
  return { workspace_id: ws.id };
});
