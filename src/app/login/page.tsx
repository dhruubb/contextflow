'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Waypoints } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button, Card, Field, Input } from '@/components/ui';
import { RoleBadge } from '@/components/badges';

const DEMO = [
  { name: 'Aisha Khan', email: 'aisha@novatech.io', role: 'admin' },
  { name: 'Rahul Sharma', email: 'rahul@novatech.io', role: 'team_lead' },
  { name: 'Priya Patel', email: 'priya@novatech.io', role: 'member' },
  { name: 'Arjun Mehta', email: 'arjun@novatech.io', role: 'member' },
  { name: 'Neha Gupta', email: 'neha@novatech.io', role: 'viewer' },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const supabase = createClient();
    const { error } =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } });
    setLoading(false);
    if (error) return toast.error(error.message);
    if (mode === 'signup') toast.success('Account created. If email confirmation is on, check your inbox.');
    router.replace('/');
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.08),transparent_60%)] p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Waypoints className="size-4" />
          </div>
          <div>
            <p className="text-sm font-semibold">ContextFlow AI</p>
            <p className="text-xs text-muted-foreground">Context that survives meetings, people and handovers.</p>
          </div>
        </div>
        <Card className="p-5">
          <form onSubmit={submit} className="space-y-3">
            {mode === 'signup' && (
              <Field label="Full name">
                <Input value={name} onChange={(e) => setName(e.target.value)} required />
              </Field>
            )}
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </Field>
            <Field label="Password">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete="current-password" />
            </Field>
            <Button type="submit" className="w-full" loading={loading}>
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </Button>
            <button type="button" className="w-full text-xs text-muted-foreground hover:text-foreground" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
              {mode === 'signin' ? 'New here? Create an account' : 'Have an account? Sign in'}
            </button>
          </form>
        </Card>
        <Card className="p-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">NovaTech demo accounts — password from your seed (default NovaTech@2026)</p>
          <div className="grid gap-1">
            {DEMO.map((d) => (
              <button
                key={d.email}
                type="button"
                onClick={() => {
                  setMode('signin');
                  setEmail(d.email);
                  if (!password) setPassword('NovaTech@2026');
                }}
                className="flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <span>
                  {d.name} <span className="text-xs text-muted-foreground">{d.email}</span>
                </span>
                <RoleBadge role={d.role} />
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
