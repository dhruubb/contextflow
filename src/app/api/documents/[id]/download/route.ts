import { NextResponse } from 'next/server';
import { route, check, notFound, ApiError } from '@/lib/api';

/** Short-lived signed URL (60s) for a private document; access checked by RLS on both the row and the object. */
export const GET = route({}, async ({ ctx, params }) => {
  const doc = check(
    await ctx.supabase.from('knowledge_documents').select('storage_path,file_name').eq('id', params.id).eq('workspace_id', ctx.workspace.id).maybeSingle(),
    'loading document',
  );
  if (!doc) throw notFound('Document');
  const { data, error } = await ctx.supabase.storage.from('documents').createSignedUrl(doc.storage_path, 60, { download: doc.file_name });
  if (error || !data) throw new ApiError(404, 'File not found in storage');
  return NextResponse.redirect(data.signedUrl);
});
