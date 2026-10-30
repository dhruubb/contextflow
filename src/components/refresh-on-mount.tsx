'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Re-fetches server data once (e.g. to clear sidebar badges after marking items read). */
export function RefreshOnMount() {
  const router = useRouter();
  useEffect(() => {
    router.refresh();
  }, [router]);
  return null;
}
