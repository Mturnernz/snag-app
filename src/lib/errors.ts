// Maps raw Supabase/Postgres error text to plain language so users never
// see raw database, auth, or RLS error strings in the app.

interface ErrorLike {
  message?: string;
}

const GENERIC = 'Something went wrong saving this. Try again — if it keeps happening, tell your admin.';

// Messages already known to be safe, plain-language text — from Supabase
// Auth or our own RPC/client-side validation — pass through unchanged.
const KNOWN_MESSAGES = new Set([
  'invalid login credentials',
  'user already registered',
  'email not confirmed',
  'password should be at least 6 characters.',
  'invalid invite code. please check and try again.',
  'not authenticated',
  'no organisation found',
]);

export function friendlyError(action: string, error: unknown): string {
  const message = (error as ErrorLike | null)?.message?.trim();

  if (!message) return GENERIC;

  if (KNOWN_MESSAGES.has(message.toLowerCase())) return message;

  if (/network request failed|fetch|timeout/i.test(message)) {
    return "Couldn't reach the server. Check your connection and try again.";
  }

  if (__DEV__) {
    console.warn(`[${action}] unmapped error:`, message);
  }

  return GENERIC;
}
