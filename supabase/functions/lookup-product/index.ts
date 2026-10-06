// lookup-product — what the maker's own website says about one model.
//
// The manual, the consumable parts a householder replaces, and how often the
// maker says it should be serviced — each kept only if this function has
// itself opened a page on the maker's own site that states it for this model
// (`verifyLookup` in lookup.ts). The year it was made is not here: that is a
// fact about one unit, printed on its plate, and `read-label` reads it there.
//
// Called from a thing's page (*Look it up*), and started by `read-label` in
// the background once a plate has given a make and a model, so the answer is
// usually waiting by the time the thing's page is opened.
//
// Four rules, the same shape as read-label's:
//
// - **It writes nothing to the record.** The answer is kept in
//   `home.product_lookups`, a waiting room; the thing's page offers it and a
//   person taps what they want.
// - **Once per make and model.** A kept answer is returned rather than looked
//   up again, so one model never has two answers. *Look again* exists only for
//   a lookup that failed.
// - **It finishes whatever the phone does** (`EdgeRuntime.waitUntil`), and the
//   caller is answered with the kept row.
// - **It spends the household's daily reads**, one per search that actually
//   runs, through `claim_label_read` — a search is a model call on the
//   operator's key like any other.
//
// Secrets: GEMINI_API_KEY, and optionally GEMINI_MODEL / GEMINI_FALLBACK_MODEL,
// shared with read-label. Google bills a grounded search separately from the
// tokens — see SNAG_INFRA_NOTES.md.
// Deploy: `supabase functions deploy lookup-product` — JWT verification on.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { modelsToTry } from '../read-label/gemini.ts';
import { lookUpAndKeep } from './run.ts';

// The whole lookup — the search, the pages opened, and the read — under the
// app's own leash (`LOOKUP_TIMEOUT_MS`, 100s), so the caller is answered in
// words before it gives up, and well inside the platform's 150s wall clock.
// `run.ts` shares it out: the search has what is left after 34s is kept back
// for opening pages and reading them. The work carries on either way.
const BUDGET_MS = 90_000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const NOT_SET_UP = "Looking things up isn't set up yet.";
const COULD_NOT = "Couldn't look that up just now.";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const words = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return answer(405, { error: 'Only POST' });

  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) return answer(503, { error: NOT_SET_UP });

  const authorization = req.headers.get('Authorization');
  if (!authorization) return answer(401, { error: 'Sign in again to look that up.' });

  let householdId: string | null;
  let make: string | null;
  let model: string | null;
  let name: string | null;
  let again: boolean;
  try {
    const body = await req.json();
    householdId = words(body?.householdId, 40);
    make = words(body?.make, 80);
    model = words(body?.model, 80);
    name = words(body?.name, 60);
    again = body?.again === true;
  } catch {
    return answer(400, { error: COULD_NOT });
  }
  if (!householdId || !UUID.test(householdId)) return answer(400, { error: COULD_NOT });
  if (!make || !model) return answer(400, { error: 'A make and a model are needed to look it up.' });

  // As the caller, so `require_member` and the read policy are what decide.
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    db: { schema: 'home' },
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const models = modelsToTry(Deno.env.get('GEMINI_MODEL'), Deno.env.get('GEMINI_FALLBACK_MODEL'));
  const work = lookUpAndKeep(supabase, apiKey, models, { householdId, make, model, name, again }, BUDGET_MS)
    .catch((err) => {
      console.error('lookup-product: failed —', err);
      return 'refused' as const;
    });
  EdgeRuntime.waitUntil(work);
  const outcome = await work;
  if (outcome === 'refused') return answer(403, { error: COULD_NOT });

  const { data, error } = await supabase.rpc('product_lookup', {
    p_household_id: householdId,
    p_make: make,
    p_model: model,
  });
  if (error) return answer(502, { error: COULD_NOT });
  const row = Array.isArray(data) ? data[0] ?? null : data ?? null;
  return answer(200, { lookup: row });
});
