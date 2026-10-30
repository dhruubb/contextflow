'use client';
import { Fragment, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, FileText, MessageSquareText, Sparkles } from 'lucide-react';
import { api } from '@/lib/client-api';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton, Textarea } from '@/components/ui';

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

/** Renders the answer text with [S#] markers as clickable citation chips and **bold** support. */
function AnswerText({ text, onCite }: { text: string; onCite: (id: string) => void }) {
  const parts = text.split(/(\[S\d+\]|\*\*[^*]+\*\*)/g);
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed">
      {parts.map((p, i) => {
        const cite = p.match(/^\[(S\d+)\]$/);
        if (cite)
          return (
            <button key={i} onClick={() => onCite(cite[1])} className="mx-0.5 inline-flex -translate-y-0.5 items-center rounded bg-indigo-500/15 px-1 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-500/25 dark:text-indigo-300">
              {cite[1]}
            </button>
          );
        if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </p>
  );
}

export function AskPanel({ documentIds, scopeLabel, disabled }: { documentIds?: string[]; scopeLabel?: string; disabled?: string }) {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Answer | null>(null);
  const [asked, setAsked] = useState('');
  const [highlight, setHighlight] = useState<string | null>(null);

  async function ask(e?: React.FormEvent) {
    e?.preventDefault();
    if (question.trim().length < 3) return;
    setLoading(true);
    setError(null);
    setResult(null);
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
    setHighlight(id);
    document.getElementById(`src-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setTimeout(() => setHighlight(null), 1600);
  }

  return (
    <Card className="border-indigo-500/30">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-1.5"><MessageSquareText className="size-4 text-indigo-500" /> Ask the knowledge base</CardTitle>
          <CardDescription>{scopeLabel ?? 'Answers come only from documents in this workspace, with citations.'}</CardDescription>
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
          <div className="animate-in mt-4 space-y-3 border-t pt-4">
            <p className="text-xs font-medium text-muted-foreground">Q: {asked}</p>
            {result.insufficient && (
              <p className="flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="size-3.5" /> The knowledge base doesn’t fully answer this — treat the answer as partial.
              </p>
            )}
            <AnswerText text={result.answer} onCite={cite} />
            <p className="text-[11px] text-muted-foreground">
              {result.mode === 'hybrid' ? 'Groq embeddings + full-text retrieval' : 'Groq-expanded full-text retrieval'}{result.reranked ? ' · Groq re-ranked' : ''}
              {result.model && ` · ${result.model}`} · {result.sources.length} source{result.sources.length === 1 ? '' : 's'} retrieved
            </p>
            {result.sources.length > 0 && (
              <ul className="space-y-1.5">
                {result.sources.map((s) => (
                  <li
                    key={s.id}
                    id={`src-${s.id}`}
                    className={`rounded-md border p-2 text-xs transition-colors ${highlight === s.id ? 'border-indigo-500 bg-indigo-500/10' : ''} ${s.cited ? '' : 'opacity-60'}`}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={s.cited ? 'indigo' : 'neutral'}>{s.id}</Badge>
                      <Link href={`/knowledge/${s.document_id}`} className="flex items-center gap-1 font-medium hover:underline"><FileText className="size-3" />{s.title}</Link>
                      <span className="text-muted-foreground">· {s.location}</span>
                      {s.relevance != null ? <span className="text-muted-foreground">· relevance {s.relevance}/10</span> : s.similarity > 0 && <span className="text-muted-foreground">· {Math.round(s.similarity * 100)}% match</span>}
                      {!s.cited && <span className="text-muted-foreground">· retrieved, not cited</span>}
                    </div>
                    <p className="mt-1 line-clamp-3 text-muted-foreground">{s.snippet}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
