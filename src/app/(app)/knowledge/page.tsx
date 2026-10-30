import Link from 'next/link';
import { BookOpen, CalendarDays, FileText, Search } from 'lucide-react';
import { requireContext } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { PageHeader } from '@/components/shell';
import { Button, Card, CardContent, CardHeader, CardTitle, Empty, Input, Table } from '@/components/ui';
import { fmtDate } from '@/lib/utils';
import { UploadButton } from './upload';
import { AskPanel } from './ask-panel';
import { Badge } from '@/components/ui';

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

  return (
    <div className="animate-in">
      <PageHeader title="Knowledge Base" description="PDF, DOCX and TXT documents with searchable text, linked to the work they support." actions={can(ctx.role, 'document.upload') && <UploadButton />} />
      <div className="mb-4"><AskPanel /></div>
      <form className="mb-4 flex max-w-lg gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input name="q" defaultValue={term} placeholder="Search documents and past meetings…" className="pl-8" />
        </div>
        <Button type="submit" variant="outline">Search</Button>
      </form>

      {term && (
        <Card className="mb-4">
          <CardHeader><CardTitle className="flex items-center gap-1.5"><CalendarDays className="size-4 text-muted-foreground" /> Meetings matching “{term}”</CardTitle></CardHeader>
          <CardContent>
            {(meetings ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No meetings match.</p>
            ) : (
              <ul className="space-y-2">
                {(meetings ?? []).map((m) => (
                  <li key={m.id}>
                    <Link href={`/meetings/${m.id}`} className="text-sm font-medium hover:underline">{m.title}</Link>
                    <span className="text-xs text-muted-foreground"> · {fmtDate(m.scheduled_at)}</span>
                    <p className="text-xs text-muted-foreground">{snippet(m.summary || m.raw_notes, term)}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        {rows.length === 0 ? (
          <div className="p-4"><Empty title={term ? 'No documents match' : 'No documents yet'} icon={<BookOpen />}>Upload runbooks, specs, policies or client documents (max 5 MB).</Empty></div>
        ) : (
          <Table>
            <thead><tr><th>Document</th><th>Index</th><th>Type</th><th>Size</th><th>Links</th><th>Uploaded</th></tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td className="max-w-md">
                    <Link href={`/knowledge/${d.id}`} className="flex items-center gap-1.5 font-medium hover:underline"><FileText className="size-4 text-muted-foreground" />{d.title}</Link>
                    {term ? <p className="text-xs text-muted-foreground">{snippet(d.extracted_text, term)}</p> : <p className="text-xs text-muted-foreground">{d.file_name}{!d.extracted_text && ' · no searchable text'}</p>}
                  </td>
                  <td className="whitespace-nowrap">
                    <Badge tone={d.status === 'ready' ? 'green' : d.status === 'failed' ? 'red' : 'indigo'} title={d.error_message ?? undefined}>
                      {d.status === 'ready' ? `${d.chunk_count} chunks${d.embedding_model ? ' · vectors' : ''}` : d.status}
                    </Badge>
                  </td>
                  <td className="text-xs uppercase text-muted-foreground">{d.file_name.split('.').pop()}</td>
                  <td className="text-xs text-muted-foreground">{(d.file_size / 1024).toFixed(0)} KB</td>
                  <td className="text-xs text-muted-foreground">{d.knowledge_links.length}</td>
                  <td className="whitespace-nowrap text-xs text-muted-foreground">{fmtDate(d.created_at)} · {d.uploader?.full_name}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
