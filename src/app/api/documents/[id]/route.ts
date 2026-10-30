import { route, check, notFound, forbidden, dbError } from '@/lib/api';
import { can } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logActivity } from '@/lib/activity';

/**
 * Deletes a document. Chunks, embeddings and knowledge links are removed by ON DELETE CASCADE;
 * the file is then removed from Storage. Allowed for team leads/admins or the uploader.
 */
export const DELETE = route({ permission: 'document.upload' }, async ({ ctx, params, log }) => {
  const doc = check(
    await ctx.supabase.from('knowledge_documents').select('id,title,storage_path,uploaded_by').eq('id', params.id).eq('workspace_id', ctx.workspace.id).maybeSingle(),
    'loading document',
  );
  if (!doc) throw notFound('Document');
  if (!can(ctx.role, 'task.manage_any') && doc.uploaded_by !== ctx.user.id) throw forbidden('Only the uploader or a team lead can delete this document');

  const { error } = await ctx.supabase.from('knowledge_documents').delete().eq('id', doc.id);
  const e = dbError(error, 'deleting document');
  if (e) throw e;

  // Authorised above; service role is used because storage delete policies only cover leads.
  const rm = await supabaseAdmin().storage.from('documents').remove([doc.storage_path]);
  if (rm.error) log.warn({ err: rm.error.message, path: doc.storage_path }, 'document row deleted but storage object removal failed');

  const { count } = await ctx.supabase.from('document_chunks').select('id', { count: 'exact', head: true }).eq('document_id', doc.id);
  log.info({ documentId: doc.id, remainingChunks: count ?? 0, storageRemoved: !rm.error }, 'document deleted');
  await logActivity(ctx, 'document.deleted', 'document', null, { title: doc.title }, log);
  return { ok: true, storageRemoved: !rm.error };
});
