import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Clock, FileText, HardDrive, UserRound, Download } from 'lucide-react';
import { requireContext } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { Badge, Card, CardContent, CardHeader, CardTitle, buttonVariants } from '@/components/ui';
import { fmtDate } from '@/lib/utils';
import { SuggestLinks } from './suggest-links';
import { FileTypeIcon, Meta, SectionHeader } from '@/components/meta';
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
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <FileTypeIcon name={doc.file_name} />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight">{doc.title}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
              <Meta icon={FileText}>{doc.file_name}</Meta>
              <Meta icon={HardDrive}>{(doc.file_size / 1024).toFixed(0)} KB</Meta>
              <Meta icon={UserRound}>{(doc.uploader as unknown as { full_name: string } | null)?.full_name ?? 'unknown'}</Meta>
              <Meta icon={Clock}>{fmtDate(doc.created_at)}</Meta>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/api/documents/${doc.id}/download`} className={buttonVariants({ variant: 'outline' })}><Download /> Download</a>
          {can(ctx.role, 'document.upload') && (can(ctx.role, 'task.manage_any') || doc.uploaded_by === ctx.user.id) && <DocActions documentId={doc.id} title={doc.title} />}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionHeader icon={FileText} title="Content preview" />
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
            <SectionHeader icon={doc.status === 'ready' ? CheckCircle2 : AlertTriangle} tone={doc.status === 'ready' ? 'text-emerald-500' : doc.status === 'failed' ? 'text-red-500' : 'text-indigo-500'} title={doc.status === 'ready' ? 'Ready for search & AI' : doc.status === 'failed' ? 'Indexing failed' : 'Indexing…'} />
            <div className="grid grid-cols-2 gap-px bg-border">
              {[
                ['Sections', String(doc.chunk_count)],
                ['Pages', doc.page_count ? String(doc.page_count) : '—'],
                ['Search', doc.embedding_model ? 'AI + vectors' : 'AI + keywords'],
                ['Indexed', doc.indexed_at ? fmtDate(doc.indexed_at).replace(/ \d{4}$/, '') : '—'],
              ].map(([k, v]) => (
                <div key={k} className="bg-card px-4 py-2.5">
                  <p className="text-[11px] text-muted-foreground">{k}</p>
                  <p className="text-sm font-medium">{v}</p>
                </div>
              ))}
            </div>
            {doc.error_message && <p className={`border-t px-4 py-2.5 text-xs ${doc.status === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-300'}`}>{doc.error_message}</p>}
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
