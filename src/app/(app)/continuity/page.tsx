import { redirect } from 'next/navigation';

// Renamed to /performance — this file can be deleted.
export default function OldContinuityRedirect() {
  redirect('/performance');
}
