'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/client-api';
import { Button, Dialog, Field, Input } from '@/components/ui';

const MAX = 5 * 1024 * 1024;

export function UploadButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const tooBig = !!file && file.size > MAX;

  async function submit() {
    if (!file) return;
    setLoading(true);
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('title', title);
      const r = await api<{ document: { id: string }; status: string; chunkCount: number; embedded: boolean; error: string | null }>('/api/documents', { form });
      if (r.status === 'failed') toast.warning(`Uploaded, but indexing failed: ${r.error}. You can re-index from the document page.`);
      else toast.success(`Indexed ${r.chunkCount} chunks${r.embedded ? ' with Groq embeddings' : ' for Groq-powered search'}`);
      setOpen(false);
      router.push(`/knowledge/${r.document.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}><Upload /> Upload document</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Upload document"
        description="PDF, DOCX or TXT · max 5 MB · stored privately in Supabase Storage"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} loading={loading} disabled={!file || tooBig}>{loading ? 'Extracting, chunking, embedding…' : 'Upload & index'}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <button type="button" onClick={() => input.current?.click()} className="flex w-full flex-col items-center justify-center rounded-lg border border-dashed p-6 text-sm hover:bg-accent/50">
            <Upload className="mb-1 size-5 text-muted-foreground" />
            {file ? <span className="font-medium">{file.name} · {(file.size / 1024).toFixed(0)} KB</span> : <span className="text-muted-foreground">Choose a file</span>}
            {tooBig && <span className="mt-1 text-xs text-red-500">File is larger than 5 MB</span>}
          </button>
          <input
            ref={input}
            type="file"
            hidden
            accept=".pdf,.docx,.txt,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
            }}
          />
          <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        </div>
      </Dialog>
    </>
  );
}
