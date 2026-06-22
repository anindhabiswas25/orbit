import { redirect } from 'next/navigation';

// The dashboard now lives at /dashboard so it can be hosted as its own page.
export default function Home() {
  redirect('/dashboard');
}
