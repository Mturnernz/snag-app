// Maps raw Supabase/Postgres error text to plain language so users never
// see database, auth, or RLS internals. Our own RPCs raise deliberate
// plain-language exceptions — those pass straight through; anything
// unrecognised gets the generic message.

interface ErrorLike {
  message?: string;
}

const GENERIC = 'Something went wrong saving this. Try again — if it keeps happening, tell your admin.';

// Every exception our RPCs raise starts with one of these (see
// supabase/migrations/*.sql). Postgres/PostgREST internals never do.
const KNOWN_PREFIXES = [
  'snag not found',
  'rca not found',
  'debrief not found',
  'corrective action not found',
  'only ',
  'this ',
  'that ',
  'you ',
  'an rca ',
  'a rejection note',
  'a hazard or incident',
  'add a note',
  'add at least one',
  'answer all five',
  'finish the first-response',
  'record a root cause',
  'close every corrective',
  'niggles use',
  'rca_pending is set automatically',
  'snags can never be deleted',
  'must be signed in',
  // Supabase Auth messages that are safe to show verbatim
  'invalid login credentials',
  'email not confirmed',
];

export function friendlyError(action: string, error: unknown): string {
  const message = (error as ErrorLike | null)?.message?.trim();

  if (!message) return GENERIC;

  const lower = message.toLowerCase();
  if (KNOWN_PREFIXES.some((p) => lower.startsWith(p))) return message;

  if (/network|failed to fetch|timeout/i.test(message)) {
    return "Couldn't reach the server. Check your connection and try again.";
  }

  if (import.meta.env.DEV) {
    console.warn(`[${action}] unmapped error:`, message);
  }

  return GENERIC;
}
