'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api, ClientApiError } from '@/lib/client-api';
import { Button } from '@/components/ui';

/** Suggested next steps from an AI brief, each one addable to the reader's own task list. */
export function NextSteps({ steps, meetingId, selfId, canAdd }: { steps: string[]; meetingId: string; selfId?: string; canAdd: boolean }) {
  const router = useRouter();
  const [added, setAdded] = useState<Record<number, string | 'exists'>>({});
  const [busy, setBusy] = useState<number | 'all' | null>(null);

  async function add(i: number) {
    try {
      const { task } = await api<{ task: { id: string } }>('/api/tasks', {
        body: { title: steps[i].slice(0, 200), description: 'Added from an AI catch-up brief.', assignee_id: selfId ?? null, source_meeting_id: meetingId, priority: 'medium' },
      });
      setAdded((a) => ({ ...a, [i]: task.id }));
      return true;
    } catch (e) {
      if (e instanceof ClientApiError && e.status === 409) {
        setAdded((a) => ({ ...a, [i]: 'exists' }));
        return true;
      }
      toast.error((e as Error).message);
      return false;
    }
  }

  async function addOne(i: number) {
    setBusy(i);
    if (await add(i)) {
      toast.success('Added to your tasks');
      router.refresh();
    }
    setBusy(null);
  }
  async function addAll() {
    setBusy('all');
    let n = 0;
    for (let i = 0; i < steps.length; i++) if (!added[i] && (await add(i))) n++;
    setBusy(null);
    if (n) toast.success(`Added ${n} task${n > 1 ? 's' : ''} to your list`);
    router.refresh();
  }

  const remaining = steps.filter((_, i) => !added[i]).length;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Next steps</p>
        {canAdd && remaining > 1 && (
          <Button size="sm" variant="ghost" onClick={addAll} loading={busy === 'all'}><Plus /> Add all to my tasks</Button>
        )}
      </div>
      <ul className="divide-y rounded-md border">
        {steps.map((s, i) => {
          const done = added[i];
          return (
            <li key={i} className="flex items-center gap-3 px-3 py-2.5">
              <span className={`flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] ${done ? 'border-emerald-500 bg-emerald-500 text-white' : 'text-muted-foreground'}`}>
                {done ? <Check className="size-3" /> : i + 1}
              </span>
              <span className="flex-1 text-sm">{s}</span>
              {canAdd &&
                (done ? (
                  done === 'exists' ? (
                    <span className="text-xs text-muted-foreground">Already in tasks</span>
                  ) : (
                    <Link href={`/tasks/${done}`} className="text-xs font-medium text-emerald-600 hover:underline dark:text-emerald-400">Added · open</Link>
                  )
                ) : (
                  <Button size="sm" variant="outline" onClick={() => addOne(i)} loading={busy === i}><Plus /> Add to my tasks</Button>
                ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
