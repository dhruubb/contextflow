'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ExternalLink, Send } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/client-api';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui';
import { fmtDate } from '@/lib/utils';

export function TelegramConnect({ connected, username, verifiedAt }: { connected: boolean; username: string | null; verifiedAt: string | null }) {
  const router = useRouter();
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run<T>(key: string, fn: () => Promise<T>) {
    setBusy(key);
    try {
      return await fn();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Telegram</CardTitle>
          <CardDescription>Secure one-time link — only you can attach your chat.</CardDescription>
        </div>
        {connected ? <Badge tone="green"><CheckCircle2 className="size-3" /> Connected</Badge> : <Badge>Not connected</Badge>}
      </CardHeader>
      <CardContent className="space-y-2">
        {connected ? (
          <>
            <p className="text-xs text-muted-foreground">{username ? `@${username} · ` : ''}linked {fmtDate(verifiedAt)}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" loading={busy === 'test'} onClick={() => run('test', async () => { const r = await api<{ outcome: string }>('/api/notifications/test', { method: 'POST' }); toast[r.outcome === 'delivered' ? 'success' : 'error'](`Test notification: ${r.outcome}`); router.refresh(); })}>
                <Send /> Send test
              </Button>
              <Button size="sm" variant="ghost" loading={busy === 'unlink'} onClick={() => run('unlink', async () => { await api('/api/telegram/link', { method: 'DELETE' }); toast.success('Telegram disconnected'); router.refresh(); })}>
                Disconnect
              </Button>
            </div>
          </>
        ) : link ? (
          <>
            <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
              <li>Open the bot and press <b>Start</b> (link valid 15 min).</li>
              <li>Come back and click “I pressed Start”.</li>
            </ol>
            <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Open Telegram <ExternalLink className="size-3.5" /></a>
            <Button size="sm" className="w-full" loading={busy === 'verify'} onClick={() => run('verify', async () => { const r = await api<{ linked: boolean; message?: string }>('/api/telegram/verify', { method: 'POST' }); if (r.linked) { toast.success('Telegram connected'); router.refresh(); } else toast.message(r.message ?? 'Not linked yet'); })}>
              I pressed Start
            </Button>
          </>
        ) : (
          <Button size="sm" className="w-full" loading={busy === 'link'} onClick={() => run('link', async () => { const r = await api<{ url: string }>('/api/telegram/link', { method: 'POST' }); setLink(r.url); window.open(r.url, '_blank'); })}>
            Connect Telegram
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

const PREFS = [
  ['notify_task_assigned', 'Task assigned to me'],
  ['notify_task_reassigned', 'Reassigned to me / my tasks completed or blocked'],
  ['notify_deadline_approaching', 'Deadline within 24h'],
  ['notify_task_overdue', 'Task overdue (daily)'],
  ['notify_meeting_scheduled', 'Meetings: invites, reminders, agenda'],
  ['notify_handover', 'Handover received'],
] as const;

type Prefs = Record<(typeof PREFS)[number][0], boolean>;

export function RunReminders() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Reminders</CardTitle>
          <CardDescription>Deadline, overdue and meeting-starting-soon alerts run automatically every morning. Send them now for this workspace — duplicates are never re-sent.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Button
          size="sm"
          className="w-full"
          variant="outline"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await api<{ tasksChecked: number; meetingsChecked: number; results: Record<string, number> }>('/api/notifications/run-reminders', { method: 'POST' });
              const sent = (r.results.delivered ?? 0) + (r.results.in_app ?? 0);
              toast.success(`Checked ${r.tasksChecked} task(s) and ${r.meetingsChecked} meeting(s) · ${sent} reminder(s) sent${r.results.skipped_duplicate ? `, ${r.results.skipped_duplicate} already sent earlier` : ''}`);
              router.refresh();
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Send /> Send due reminders now
        </Button>
      </CardContent>
    </Card>
  );
}

export function Preferences({ initial }: { initial: Prefs }) {
  const [prefs, setPrefs] = useState(initial);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(prefs) !== JSON.stringify(initial);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Preferences</CardTitle>
        {dirty && (
          <Button size="sm" loading={saving} onClick={async () => { setSaving(true); try { await api('/api/notifications/preferences', { method: 'PUT', body: prefs }); toast.success('Preferences saved'); } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); } }}>
            Save
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {PREFS.map(([key, label]) => (
          <label key={key} className="flex items-center justify-between text-sm">
            {label}
            <input type="checkbox" checked={prefs[key]} onChange={() => setPrefs({ ...prefs, [key]: !prefs[key] })} className="size-4 accent-[hsl(var(--primary))]" />
          </label>
        ))}
      </CardContent>
    </Card>
  );
}
