import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// For use in Server Components, Server Actions, and Route Handlers. Reads/
// writes the session cookie set/refreshed by middleware.ts.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component (no request/response to write
            // cookies to) — safe to ignore as long as middleware.ts is
            // refreshing the session on every request.
          }
        },
      },
    }
  );
}
