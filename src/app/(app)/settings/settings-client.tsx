'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/client-api';
import { Select } from '@/components/ui';

export function RoleSelect({ memberId, role }: { memberId: string; role: string }) {
  const router = useRouter();
  const [value, setValue] = useState(role);
  const [busy, setBusy] = useState(false);
  return (
    <Select
      value={value}
      disabled={busy}
      className="h-8 w-36 text-xs"
      onChange={async (e) => {
        const next = e.target.value;
        setBusy(true);
        try {
          await api(`/api/members/${memberId}`, { method: 'PATCH', body: { role: next } });
          setValue(next);
          toast.success('Role updated');
          router.refresh();
        } catch (err) {
          toast.error((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <option value="admin">Admin</option>
      <option value="team_lead">Team Lead</option>
      <option value="member">Member</option>
      <option value="viewer">Viewer</option>
    </Select>
  );
}
