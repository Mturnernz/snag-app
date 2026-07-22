import { createBrowserClient } from '@supabase/ssr';

// For use in Client Components. Session lives in cookies (via @supabase/ssr),
// not localStorage, so it's readable by the server client / middleware too.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
