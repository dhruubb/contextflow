import Link from 'next/link';
import { AlertTriangle, BookOpen, CalendarDays, CheckCircle2, Clock, FileSearch, Link2, Loader2, Search, Sparkles } from 'lucide-react';
import { requireContext } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { PageHeader } from '@/components/shell';
import { Avatar, Button, Card, Empty, Input } from '@/components/ui';
import { FileTypeIcon, Meta, SectionHeader } from '@/components/meta';
import { fmtDate, relTime } from '@/lib/utils';
import { UploadButton } from './upload';
import { AskPanel } from './ask-panel';

export const metadata = { title: 'Knowledge Base' };

function snippet(text: string | null, q: string) {
  if (!text) return null;
  const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const lower = text.toLowerCase();
  const idx = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, idx - 80);
  return (start > 0 ? '…' : '') + text.slice(start, start + 220).replace(/\s+/g, ' ') + '…';
}

export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireContext();
  const { q } = await searchParams;
  const term = q?.trim();

  const docsQ = ctx.supabase
    .from('knowledge_documents')
    .select('id,title,file_name,file_type,file_size,created_at,extracted_text,status,chunk_count,embedding_model,error_message,uploader:profiles(full_name),knowledge_links(id)')
    .eq('workspace_id', ctx.workspace.id)
    .order('created_at', { ascending: false });
  const [{ data: docs }, { data: meetings }] = await Promise.all([
    term ? docsQ.textSearch('search', term, { type: 'websearch', config: 'english' }) : docsQ,
    term
      ? ctx.supabase.from('meetings').select('id,title,scheduled_at,summary,raw_notes').eq('workspace_id', ctx.workspace.id).textSearch('search', term, { type: 'websearch', config: 'english' }).limit(10)
      : Promise.resolve({ data: null }),
  ]);
  type Doc = { id: string; title: string; file_name: string; file_type: string; file_size: number; created_at: string; extracted_text: string | null; uploader: { full_name: string } | null; knowledge_links: { id: string }[]; status: string; chunk_count: number; embedding_model: string | null; error_message: string | null };
  const rows = (docs ?? []) as unknown as Doc[];

  const Status = ({ d }: { d: Doc }) =>
    d.status === 'ready' ? (
      <Meta icon={CheckCircle2} className="text-emerald-600 dark:text-emerald-400" title={d.error_message ?? `${d.chunk_count} searchable sections`}>Searchable</Meta>
    ) : d.status === 'failed' ? (
      <Meta icon={AlertTriangle} className="text-red-600 dark:text-red-400" title={d.error_message ?? undefined}>Needs re-index</Meta>
    ) : (
      <Meta icon={Loader2} className="text-indigo-600 dark:text-indigo-400">Indexing…</Meta>
    );

  return (
    <div className="animate-in space-y-5">
      <PageHeader title="Knowledge Base" description="Your team’s documents — searchable, and answerable by AI." actions={can(ctx.role, 'document.upload') && <UploadButton />} />
      <AskPanel />

      <Card>
        <SectionHeader
          icon={BookOpen}
          title="Documents"
          count={rows.length}
          action={
            <form className="flex items-center gap-1.5">
              <div className="relative">
                <Search className="absolute left-2.5 top-2 size-4 text-muted-foreground" />
                <Input name="q" defaultValue={term} placeholder="Search documents & meetings" className="h-8 w-60 pl-8 text-sm" />
              </div>
              <Button type="submit" size="sm" variant="ghost">Search</Button>
            </form>
          }
        />
        {term && (
          <div className="border-b bg-muted/20 px-5 py-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><CalendarDays className="size-3.5" /> Meetings mentioning “{term}”</p>
            {(meetings ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">None.</p>
            ) : (
              <ul className="space-y-1.5">
                {(meetings ?? []).map((m) => (
                  <li key={m.id}>
                    <Link href={`/meetings/${m.id}`} className="text-sm font-medium hover:underline">{m.title}</Link>
                    <span className="ml-2 text-xs text-muted-foreground">{fmtDate(m.scheduled_at)}</span>
                    <p className="line-clamp-1 text-xs text-muted-foreground">{snippet(m.summary || m.raw_notes, term)}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {rows.length === 0 ? (
          <div className="p-6"><Empty title={term ? 'No documents match' : 'No documents yet'} icon={<FileSearch />}>Upload runbooks, specs, policies or client documents (PDF, DOCX, TXT · max 5 MB).</Empty></div>
        ) : (
          <ul className="divide-y">
            {rows.map((d) => (
              <li key={d.id}>
                <Link href={`/knowledge/${d.id}`} className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-accent/40">
                  <FileTypeIcon name={d.file_name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{d.title}</p>
                    {term ? (
                      <p className="line-clamp-1 text-xs text-muted-foreground">{snippet(d.extracted_text, term)}</p>
                    ) : (
                      <div className="mt-1 flex flex-wrap items-center gap-x-3.5 gap-y-1">
                        <Status d={d} />
                        {d.knowledge_links.length > 0 && <Meta icon={Link2}>{d.knowledge_links.length} linked</Meta>}
                        {d.embedding_model && <Meta icon={Sparkles}>vectors</Meta>}
                        <Meta icon={Clock}>{relTime(d.created_at)}</Meta>
                      </div>
                    )}
                  </div>
                  <span className="hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:flex">
                    <Avatar name={d.uploader?.full_name} className="size-5 text-[9px]" />
                    {d.uploader?.full_name?.split(' ')[0]}
                  </span>
                  <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{(d.file_size / 1024).toFixed(0)} KB</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
