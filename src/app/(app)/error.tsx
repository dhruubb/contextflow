'use client';
import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button, Card } from '@/components/ui';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Card className="mx-auto mt-10 max-w-lg p-6 text-center">
      <AlertTriangle className="mx-auto mb-2 size-6 text-amber-500" />
      <h2 className="text-sm font-semibold">Something went wrong loading this page</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {error.message?.includes('Missing environment variable') ? error.message : 'Your data is safe. Try again, and check the server logs if it persists.'}
        {error.digest && <span className="block pt-1 font-mono">ref: {error.digest}</span>}
      </p>
      <Button className="mt-4" variant="outline" onClick={reset}>
        Try again
      </Button>
    </Card>
  );
}
