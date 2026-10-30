import { createHash } from 'node:crypto';
import { route, ApiError } from '@/lib/api';
import { ALLOWED, MAX_UPLOAD_BYTES, detectKind } from '@/lib/extract';
import { indexDocument } from '@/lib/rag/ingest';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logActivity } from '@/lib/activity';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Upload PDF/DOCX/TXT (≤5 MB) → private Supabase Storage → document row (status=processing)
 * → extract → chunk → embed → pgvector. Duplicate files (same SHA-256 in this workspace) are rejected.
 */
export const POST = route({ formData: true, permission: 'document.upload' }, async ({ ctx, form, log }) => {
  const file = form?.get('file');
  const title = String(form?.get('title') ?? '').trim().slice(0, 200);
  if (!(file instanceof File)) throw new ApiError(400, 'Attach a file');
  if (file.size === 0) throw new ApiError(400, 'The file is empty');
  if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, 'Files must be 5 MB or smaller');

  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = detectKind(file.name, bytes);
  if (!kind) throw new ApiError(415, 'Only PDF, DOCX and TXT files are allowed (checked by content, not just extension)');
  const { mime } = ALLOWED[kind];
  const hash = createHash('sha256').update(bytes).digest('hex');

  const { data: dupe } = await ctx.supabase.from('knowledge_documents').select('id,title').eq('workspace_id', ctx.workspace.id).eq('content_hash', hash).maybeSingle();
  if (dupe) throw new ApiError(409, `This file is already in the knowledge base as "${dupe.title}"`, { documentId: dupe.id });

  const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-120);
  const path = `${ctx.workspace.id}/${crypto.randomUUID()}-${safeName}`;
  const up = await ctx.supabase.storage.from('documents').upload(path, bytes, { contentType: mime, upsert: false });
  if (up.error) throw new ApiError(400, `Storage upload failed: ${up.error.message}`);

  const { data: doc, error } = await ctx.supabase
    .from('knowledge_documents')
    .insert({
      workspace_id: ctx.workspace.id,
      title: title || file.name.replace(/\.[^.]+$/, ''),
      file_name: file.name,
      file_type: mime,
      file_size: file.size,
      storage_path: path,
      uploaded_by: ctx.user.id,
      content_hash: hash,
      status: 'processing',
    })
    .select('id,title')
    .single();
  if (error || !doc) {
    // Don't leave an orphaned file behind.
    await supabaseAdmin().storage.from('documents').remove([path]);
    if (error?.code === '23505') throw new ApiError(409, 'This file is already in the knowledge base');
    throw new ApiError(500, `Could not save document: ${error?.message}`);
  }

  const result = await indexDocument(ctx, doc.id, kind, bytes, log);
  await logActivity(ctx, 'document.uploaded', 'document', doc.id, { title: doc.title, kind, size: file.size, chunks: result.chunkCount, status: result.status }, log);
  return { document: doc, ...result };
});
