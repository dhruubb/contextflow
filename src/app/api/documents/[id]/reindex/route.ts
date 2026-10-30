import { route, check, notFound, forbidden, ApiError } from '@/lib/api';
import { can } from '@/lib/rbac';
import { kindFromMime } from '@/lib/extract';
import { indexDocument } from '@/lib/rag/ingest';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Re-runs extraction + chunking + embedding from the stored file (e.g. after a failure or provider change). */
export const POST = route({ permission: 'document.upload' }, async ({ ctx, params, log }) => {
  const doc = check(
    await ctx.supabase.from('knowledge_documents').select('id,file_type,storage_path,uploaded_by,status,processing_started_at').eq('id', params.id).eq('workspace_id', ctx.workspace.id).maybeSingle(),
    'loading document',
  );
  if (!doc) throw notFound('Document');
  if (!can(ctx.role, 'task.manage_any') && doc.uploaded_by !== ctx.user.id) throw forbidden('Only the uploader or a team lead can re-index this document');
  const startedAt = doc.processing_started_at ? new Date(doc.processing_started_at).getTime() : 0;
  if (doc.status === 'processing' && Date.now() - startedAt < 2 * 60_000) throw new ApiError(409, 'This document is already being indexed');

  const kind = kindFromMime(doc.file_type);
  if (!kind) throw new ApiError(415, 'Unsupported file type');
  const { data: blob, error } = await ctx.supabase.storage.from('documents').download(doc.storage_path);
  if (error || !blob) throw new ApiError(404, `Stored file could not be read: ${error?.message ?? 'missing'}`);

  return indexDocument(ctx, doc.id, kind, new Uint8Array(await blob.arrayBuffer()), log);
});
