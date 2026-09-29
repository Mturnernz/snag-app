import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * No function in `home` may be executable by `public`, and nothing else can
 * check it.
 *
 * Postgres grants EXECUTE to PUBLIC on every function it creates, and `anon`
 * and every other role inherit it. The home schema's grants are written out by
 * name to `authenticated`, and from `20260921*` on each migration also said
 * `revoke ... from public, anon` — but the eighty functions written before that
 * never did, so until `20260929014049` every one of them was executable by a
 * signed-out caller. What stood in the way was only that `anon` has no USAGE on
 * the schema: one grant away from every write function in the app answering
 * the anon key, and the advisor listing all of them as it was.
 *
 * So what is pinned is the **effective** state — what the migrations, applied
 * in order, leave each function's PUBLIC grant as — the `viewSecurity.test.ts`
 * shape. A function is keyed by its signature, because that is what Postgres
 * keys it by: `create or replace` over an existing signature keeps its grants,
 * while a new argument list is a new function and arrives with PUBLIC on it.
 * That second case is the one that would slip past a check by name.
 */

const MIGRATIONS = join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations');

/** Everything before this is the retired product's `public` schema. */
const HOME_ERA = '20260911';

const CREATE = /create\s+(?:or\s+replace\s+)?function\s+home\.(\w+)\s*\(/gi;
const DROP = /drop\s+function\s+(?:if\s+exists\s+)?home\.(\w+)\s*\(/gi;
const PRIVILEGE =
  /\b(revoke|grant)\s+(?:execute|all(?:\s+privileges)?)\s+on\s+function\s+home\.(\w+)\s*\(/gi;
const MODES = new Set(['in', 'inout', 'variadic']);
/** The types that are more than one word, so a bare one is not read as `name type`. */
const MULTI_WORD_TYPES = /^(timestamp|time) (with|without) time zone$|^double precision$|^character varying$/;

const TYPE_ALIASES: Record<string, string> = {
  timestamptz: 'timestamp with time zone',
  int: 'integer',
  int4: 'integer',
  int8: 'bigint',
  bool: 'boolean',
  varchar: 'character varying',
};

/** The text between the bracket at `open` and its partner, and where it ends. */
function bracketed(sql: string, open: number): { inner: string; end: number } {
  let depth = 0;
  for (let i = open; i < sql.length; i += 1) {
    if (sql[i] === '(') depth += 1;
    if (sql[i] === ')') {
      depth -= 1;
      if (depth === 0) return { inner: sql.slice(open + 1, i), end: i + 1 };
    }
  }
  throw new Error(`Unbalanced bracket at ${open}`);
}

function splitTopLevel(raw: string): string[] {
  // Comments first: one reading "because there is no total to change, …"
  // would otherwise be split at its comma.
  const text = raw.replace(/--[^\n]*/g, '');
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') depth -= 1;
    else if (text[i] === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

function normaliseType(type: string): string {
  const bare = type
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\(\s*\d+\s*(,\s*\d+\s*)?\)/g, '') // numeric(12,2) is numeric
    .trim();
  const array = bare.endsWith('[]');
  const base = array ? bare.slice(0, -2).trim() : bare;
  return (TYPE_ALIASES[base] ?? base) + (array ? '[]' : '');
}

/**
 * The argument types of a declaration or a reference, as Postgres keys them.
 * A declaration carries names, modes and defaults; a revoke carries only
 * types. OUT arguments are not part of the signature.
 */
function signatureTypes(args: string, declared: boolean): string[] {
  return splitTopLevel(args).flatMap((arg) => {
    let words = arg.replace(/\s+(default\b|=)[\s\S]*$/i, '').trim().split(/\s+/);
    if (words[0].toLowerCase() === 'out') return [];
    if (MODES.has(words[0].toLowerCase())) words = words.slice(1);
    // A declared argument is `name type`; a bare type is the rare case.
    const bare = normaliseType(words.join(' ')).replace(/\[\]$/, '');
    if (declared && words.length > 1 && !MULTI_WORD_TYPES.test(bare)) words = words.slice(1);
    return [normaliseType(words.join(' '))];
  });
}

interface FunctionState {
  publicCanExecute: boolean;
  setBy: string;
}

/** Replays every home-era migration and reports each function's PUBLIC grant. */
function effectiveGrants(): Map<string, FunctionState> {
  const state = new Map<string, FunctionState>();

  const files = readdirSync(MIGRATIONS)
    .filter((n) => n.endsWith('.sql') && n >= HOME_ERA)
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    type Event = { at: number; apply: () => void };
    const events: Event[] = [];

    for (const m of sql.matchAll(CREATE)) {
      const at = m.index ?? 0;
      const { inner } = bracketed(sql, at + m[0].length - 1);
      const key = `${m[1]}(${signatureTypes(inner, true).join(', ')})`;
      // A replace over an existing signature keeps its grants; anything else
      // is a new function, and a new function arrives executable by PUBLIC.
      events.push({
        at,
        apply: () => {
          if (!state.has(key)) state.set(key, { publicCanExecute: true, setBy: file });
        },
      });
    }

    for (const m of sql.matchAll(DROP)) {
      const at = m.index ?? 0;
      const { inner } = bracketed(sql, at + m[0].length - 1);
      const key = `${m[1]}(${signatureTypes(inner, false).join(', ')})`;
      events.push({ at, apply: () => state.delete(key) });
    }

    for (const m of sql.matchAll(PRIVILEGE)) {
      const at = m.index ?? 0;
      const { inner, end } = bracketed(sql, at + m[0].length - 1);
      const key = `${m[2]}(${signatureTypes(inner, false).join(', ')})`;
      const tail = sql.slice(end, sql.indexOf(';', end));
      const roles = /\b(?:from|to)\s+([\s\S]*)$/i.exec(tail)?.[1] ?? '';
      if (!/\bpublic\b/i.test(roles)) continue;
      const revoke = m[1].toLowerCase() === 'revoke';
      events.push({
        at,
        apply: () => {
          const existing = state.get(key);
          if (existing) state.set(key, { publicCanExecute: !revoke, setBy: file });
        },
      });
    }

    for (const event of events.sort((a, b) => a.at - b.at)) event.apply();
  }

  return state;
}

describe('no home function is executable by public', () => {
  const state = effectiveGrants();
  const functions = [...state.entries()];

  it('finds the functions to check at all', () => {
    // A parser that quietly matched nothing would pass every assertion below.
    expect(functions.length).toBeGreaterThan(120);
    expect(state.has('is_member(uuid)')).toBe(true);
    expect(state.has('create_snag(uuid, text, text, text[], home.snag_priority, uuid, '
      + 'timestamp with time zone, integer, uuid, uuid)')).toBe(true);
  });

  // The case a check by name would miss: an overload is a second function.
  it('keeps overloads apart', () => {
    const createThing = functions.filter(([key]) => key.startsWith('create_thing('));
    expect(createThing.length).toBe(2);
  });

  it.each(functions.map(([key, s]) => [key, s.setBy, s.publicCanExecute] as const))(
    'home.%s, as %s leaves it, is not executable by public',
    (_key, _setBy, publicCanExecute) => {
      expect(publicCanExecute).toBe(false);
    }
  );
});
