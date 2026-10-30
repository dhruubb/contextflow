'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Link2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/client-api';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui';

interface S { target_type: 'action_item' | 'meeting' | 'decision'; target_id: string; relevance: number; reason: string; title: string }

export function SuggestLinks({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [items, setItems] = useState<S[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function suggest() {
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ suggestions: S[] }>(`/api/documents/${documentId}/suggest`, { method: 'POST' });
      setItems(r.suggestions);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function link(s: S) {
    setLinking(s.target_id);
    try {
      await api(`/api/documents/${documentId}/links`, { body: { target_type: s.target_type, target_id: s.target_id, relevance: s.relevance, reason: s.reason } });
      setItems((items ?? []).filter((x) => x.target_id !== s.target_id));
      toast.success('Linked');
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLinking(null);
    }
  }

  return (
    <Card className="border-indigo-500/30">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-1.5"><Sparkles className="size-4 text-indigo-500" /> AI link suggestions</CardTitle>
          <CardDescription>Full-text retrieval + Groq ranks related tasks, meetings and decisions.</CardDescription>
        </div>
        <Button size="sm" variant="secondary" onClick={suggest} loading={loading}>{items ? 'Refresh' : 'Suggest'}</Button>
      </CardHeader>
      <CardContent>
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        {items && items.length === 0 && <p className="text-xs text-muted-foreground">No new relevant items found.</p>}
        <ul className="space-y-2">
          {(items ?? []).map((s) => (
            <li key={s.target_id} className="rounded-md border p-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium">{s.title}</p>
                <Badge tone="indigo">{Math.round(s.relevance * 100)}%</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{s.target_type.replace('_', ' ')} · {s.reason}</p>
              <Button size="sm" variant="outline" className="mt-1.5" onClick={() => link(s)} loading={linking === s.target_id}><Link2 /> Link</Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
