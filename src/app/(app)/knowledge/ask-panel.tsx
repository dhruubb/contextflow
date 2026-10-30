'use client';
import { Fragment, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronDown, Copy, FileText, MessageSquareText, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/client-api';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton, Textarea } from '@/components/ui';

interface Source {
  id: string;
  document_id: string;
  title: string;
  file_name: string;
  location: string;
  similarity: number;
  relevance: number | null;
  snippet: string;
  cited: boolean;
}
interface Answer {
  answer: string;
  insufficient: boolean;
  mode: 'hybrid' | 'keyword';
  reranked?: boolean;
  model?: string;
  sources: Source[];
}

/** Inline text with [S1] / [S1, S2] citation chips and **bold**. */
function Inline({ text, onCite }: { text: string; onCite: (id: string) => void }) {
  const parts = text.split(/(\[S\d+(?:\s*,\s*S\d+)*\]|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) => {
        const cite = p.match(/^\[(S\d+(?:\s*,\s*S\d+)*)\]$/);
        if (cite)
          return cite[1].split(/\s*,\s*/).map((id) => (
            <button key={`${i}-${id}`} onClick={() => onCite(id)} title="Show source" className="ml-1 inline-flex -translate-y-px items-center rounded bg-indigo-500/15 px-1 text-[10px] font-semibold leading-4 text-indigo-700 hover:bg-indigo-500/25 dark:text-indigo-300">
              {id.slice(1)}
            </button>
          ));
        if (p.startsWith('**') && p.endsWith('**')) return <strong key={i} className="font-semibold">{p.slice(2, -2)}</strong>;
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

/** Small markdown subset: paragraphs and "- " / "1. " lists. Drops trailing "Sources:" lines. */
function AnswerBody({ text, onCite }: { text: string; onCite: (id: string) => void }) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^\[?sources?:/i.test(l));
  const blocks: { type: 'p' | 'ul' | 'ol'; items: string[] }[] = [];
  for (const l of lines) {
    const ul = l.match(/^[-*•]\s+(.*)/);
    const ol = l.match(/^\d+[.)]\s+(.*)/);
    const type = ul ? 'ul' : ol ? 'ol' : 'p';
    const content = ul?.[1] ?? ol?.[1] ?? l;
    const last = blocks[blocks.length - 1];
    if (type !== 'p' && last?.type === type) last.items.push(content);
    else blocks.push({ type, items: [content] });
  }
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {blocks.map((b, i) =>
        b.type === 'p' ? (
          <p key={i}><Inline text={b.items[0]} onCite={onCite} /></p>
        ) : (
          <ul key={i} className="space-y-1">
            {b.items.map((it, j) => (
              <li key={j} className="flex gap-2">
                <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-primary/70" />
                <span><Inline text={it} onCite={onCite} /></span>
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

export function AskPanel({ documentIds, scopeLabel, disabled }: { documentIds?: string[]; scopeLabel?: string; disabled?: string }) {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Answer | null>(null);
  const [asked, setAsked] = useState('');
  const [highlight, setHighlight] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const cited = (result?.sources ?? []).filter((s) => s.cited);
  const uncited = (result?.sources ?? []).filter((s) => !s.cited);

  async function ask(e?: React.FormEvent) {
    e?.preventDefault();
    if (question.trim().length < 3) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setShowAll(false);
    setAsked(question.trim());
    try {
      setResult(await api<Answer>('/api/knowledge/ask', { body: { question: question.trim(), document_ids: documentIds } }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function cite(id: string) {
    if (uncited.some((s) => s.id === id)) setShowAll(true);
    setHighlight(id);
    setTimeout(() => {
      const el = document.getElementById(`src-${id}`);
      const d = el?.querySelector('details');
      if (d) d.open = true;
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 30);
    setTimeout(() => setHighlight(null), 1600);
  }

  return (
    <Card className="border-indigo-500/30">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-1.5"><MessageSquareText className="size-4 text-indigo-500" /> Ask the knowledge base</CardTitle>
          <CardDescription>{scopeLabel ?? 'Ask a question — answers come only from your documents, with sources.'}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {disabled ? (
          <p className="text-xs text-muted-foreground">{disabled}</p>
        ) : (
          <form onSubmit={ask} className="flex flex-col gap-2 sm:flex-row">
            <Textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }}
              rows={2}
              placeholder="e.g. Which port should serverless functions use for the database pooler?"
              className="min-h-[40px] flex-1"
            />
            <Button type="submit" variant="secondary" loading={loading} disabled={question.trim().length < 3} className="sm:self-start">
              <Sparkles /> Ask
            </Button>
          </form>
        )}

        {loading && (
          <div className="mt-4 space-y-2">
            <p className="text-xs text-muted-foreground">Searching documents and drafting a grounded answer…</p>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        )}
        {error && <p className="mt-3 rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

        {result && (
          <div className="animate-in mt-4 space-y-4 border-t pt-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-medium text-muted-foreground">{asked}</p>
              <button onClick={() => { navigator.clipboard.writeText(result.answer.replace(/\s*\[S\d+(?:\s*,\s*S\d+)*\]/g, '')); toast.success('Answer copied'); }} className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <Copy className="size-3.5" /> Copy
              </button>
            </div>

            {result.insufficient && (
              <p className="flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="size-3.5" /> Your documents only partly answer this.
              </p>
            )}

            <AnswerBody text={result.answer} onCite={cite} />

            {cited.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sources</p>
                <ul className="divide-y rounded-md border">
                  {[...cited, ...(showAll ? uncited : [])].map((s) => (
                    <li key={s.id} id={`src-${s.id}`} className={`transition-colors ${highlight === s.id ? 'bg-indigo-500/10' : ''}`}>
                      <details className="group">
                        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm">
                          <span className={`flex size-5 shrink-0 items-center justify-center rounded text-[10px] font-semibold ${s.cited ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300' : 'bg-muted text-muted-foreground'}`}>{s.id.slice(1)}</span>
                          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate">{s.title}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{s.location}</span>
                          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                        </summary>
                        <div className="px-3 pb-3 pl-10">
                          <p className="rounded-md bg-muted/50 p-2.5 text-xs leading-relaxed text-muted-foreground">“{s.snippet}”</p>
                          <Link href={`/knowledge/${s.document_id}`} className="mt-1.5 inline-block text-xs font-medium text-primary hover:underline">Open document →</Link>
                        </div>
                      </details>
                    </li>
                  ))}
                </ul>
                {uncited.length > 0 && (
                  <button onClick={() => setShowAll((v) => !v)} className="mt-1.5 text-xs text-muted-foreground hover:text-foreground">
                    {showAll ? 'Hide extra sources' : `Show ${uncited.length} more related passage${uncited.length > 1 ? 's' : ''}`}
                  </button>
                )}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground/70" title={`${result.mode === 'hybrid' ? 'Vector + full-text' : 'Full-text'} retrieval${result.reranked ? ', AI re-ranked' : ''}${result.model ? ` · ${result.model}` : ''}`}>
              Answered only from your workspace documents.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
