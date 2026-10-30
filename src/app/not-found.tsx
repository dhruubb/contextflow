import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="text-sm font-semibold">Not found</p>
      <p className="mt-1 text-xs text-muted-foreground">It may have been deleted, or it belongs to a workspace you are not a member of.</p>
      <Link href="/" className="mt-3 text-sm text-primary hover:underline">Back to dashboard</Link>
    </div>
  );
}
