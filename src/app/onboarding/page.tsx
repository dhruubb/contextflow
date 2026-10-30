'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/client-api';
import { Button, Card, Field, Input } from '@/components/ui';

export default function Onboarding() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { workspace_id } = await api<{ workspace_id: string }>('/api/workspace', { body: { name } });
      await api('/api/workspace/switch', { body: { workspace_id } });
      toast.success('Workspace created');
      router.replace('/');
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm p-5">
        <h1 className="text-base font-semibold">Create a workspace</h1>
        <p className="mb-4 text-xs text-muted-foreground">Each workspace is fully isolated. You will be its admin.</p>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Workspace name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} placeholder="Acme Inc" />
          </Field>
          <Button type="submit" className="w-full" loading={loading}>
            Create workspace
          </Button>
        </form>
      </Card>
    </div>
  );
}
