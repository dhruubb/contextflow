'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/client-api';
import { Button, Dialog } from '@/components/ui';

export function DocActions({ documentId, title }: { documentId: string; title: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'reindex' | 'delete' | null>(null);
  const [confirm, setConfirm] = useState(false);

  async function reindex() {
    setBusy('reindex');
    try {
      const r = await api<{ status: string; chunkCount: number; embedded: boolean; error: string | null }>(`/api/documents/${documentId}/reindex`, { method: 'POST' });
      if (r.status === 'ready') toast.success(`Re-indexed · ${r.chunkCount} chunks${r.embedded ? ' with Groq embeddings' : ''}`);
      else toast.error(r.error ?? 'Indexing failed');
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function remove() {
    setBusy('delete');
    try {
      await api(`/api/documents/${documentId}`, { method: 'DELETE' });
      toast.success('Document, chunks and embeddings deleted');
      router.push('/knowledge');
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={reindex} loading={busy === 'reindex'}><RefreshCw /> Re-index</Button>
      <Button variant="outline" onClick={() => setConfirm(true)} className="text-red-600 hover:text-red-600 dark:text-red-400"><Trash2 /> Delete</Button>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete document?"
        description={`“${title}” will be removed with all its chunks, embeddings and links. This cannot be undone.`}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={remove} loading={busy === 'delete'}>Delete</Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">The file is also removed from Supabase Storage.</p>
      </Dialog>
    </>
  );
}
