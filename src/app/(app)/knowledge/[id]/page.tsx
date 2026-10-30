import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Download } from 'lucide-react';
import { requireContext } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { PageHeader } from '@/components/shell';
import { Badge, Card, CardContent, CardHeader, CardTitle, buttonVariants } from '@/components/ui';
import { fmtDate } from '@/lib/utils';
import { SuggestLinks } from './suggest-links';
import { DocActions } from './doc-actions';
import { AskPanel } from '../ask-panel';

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const { data: doc } = await ctx.supabase
    .from('knowledge_documents')
    .select('id,title,file_name,file_type,file_size,extracted_text,created_at,uploaded_by,status,error_message,chunk_count,page_count,embedding_model,indexed_at,uploader:profiles(full_name)')
    .eq('id', id)
    .eq('workspace_id', ctx.workspace.id)
    .maybeSingle();
  if (!doc) notFound();

  const { data: links } = await ctx.supabase.from('knowledge_links').select('id,target_type,target_id,relevance_score,reason').eq('document_id', id);
  const byType = (t: string) => (links ?? []).filter((l) => l.target_type === t).map((l) => l.target_id);
  const [{ data: tasks }, { data: meetings }, { data: decisions }] = await Promise.all([
    ctx.supabase.from('action_items').select('id,title').in('id', byType('action_item')),
    ctx.supabase.from('meetings').select('id,title').in('id', byType('meeting')),
    ctx.supabase.from('decisions').select('id,title,meeting_id').in('id', byType('decision')),
  ]);
  const title = (l: { target_type: string; target_id: string }) =>
    l.target_type === 'action_item' ? tasks?.find((t) => t.id === l.target_id)?.title : l.target_type === 'meeting' ? meetings?.find((m) => m.id === l.target_id)?.title : decisions?.find((d) => d.id === l.target_id)?.title;
  const href = (l: { target_type: string; target_id: string }) =>
    l.target_type === 'action_item' ? `/tasks/${l.target_id}` : l.target_type === 'meeting' ? `/meetings/${l.target_id}` : `/meetings/${decisions?.find((d) => d.id === l.target_id)?.meeting_id ?? ''}`;

  return (
    <div className="animate-in">
      <PageHeader
        title={doc.title}
        description={`${doc.file_name} · ${(doc.file_size / 1024).toFixed(0)} KB · uploaded ${fmtDate(doc.created_at)} by ${(doc.uploader as unknown as { full_name: string } | null)?.full_name ?? 'unknown'}`}
        actions={
          <>
            <a href={`/api/documents/${doc.id}/download`} className={buttonVariants({ variant: 'outline' })}><Download /> Download</a>
            {can(ctx.role, 'document.upload') && (can(ctx.role, 'task.manage_any') || doc.uploaded_by === ctx.user.id) && <DocActions documentId={doc.id} title={doc.title} />}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Extracted text preview</CardTitle></CardHeader>
          <CardContent>
            {doc.extracted_text ? (
              <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 font-sans text-[13px] leading-relaxed">{doc.extracted_text.slice(0, 20_000)}{doc.extracted_text.length > 20_000 && '\n\n… (truncated preview)'}</pre>
            ) : (
              <p className="text-sm text-muted-foreground">No text could be extracted (e.g. a scanned PDF). The file is still downloadable.</p>
            )}
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>RAG index</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 text-xs">
              <p className="flex items-center gap-2">
                Status <Badge tone={doc.status === 'ready' ? 'green' : doc.status === 'failed' ? 'red' : 'indigo'}>{doc.status}</Badge>
              </p>
              {doc.error_message && <p className={`rounded border p-2 ${doc.status === 'failed' ? 'border-red-500/30 bg-red-500/5 text-red-600 dark:text-red-400' : 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300'}`}>{doc.error_message}</p>}
              <p className="text-muted-foreground">{doc.chunk_count} chunks{doc.page_count ? ` · ${doc.page_count} pages` : ''}</p>
              <p className="text-muted-foreground">{doc.embedding_model ? `Groq embeddings: ${doc.embedding_model} (768-d)` : 'Full-text index (Groq query expansion + re-ranking at search time)'}</p>
              {doc.indexed_at && <p className="text-muted-foreground">Indexed {fmtDate(doc.indexed_at)}</p>}
            </CardContent>
          </Card>
          {doc.status === 'ready' && <AskPanel documentIds={[doc.id]} scopeLabel="Answers only from this document." />}
          <Card>
            <CardHeader><CardTitle>Linked to</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(links ?? []).length === 0 && <p className="text-xs text-muted-foreground">Not linked yet.</p>}
              {(links ?? []).map((l) => (
                <div key={l.id} className="text-sm">
                  <Badge tone="neutral" className="mr-1.5">{l.target_type.replace('_', ' ')}</Badge>
                  <Link href={href(l)} className="hover:underline">{title(l) ?? 'Item'}</Link>
                  {l.reason && <p className="text-xs text-muted-foreground">{l.reason}</p>}
                </div>
              ))}
            </CardContent>
          </Card>
          {can(ctx.role, 'document.link') && doc.extracted_text && <SuggestLinks documentId={doc.id} />}
        </div>
      </div>
    </div>
  );
}
