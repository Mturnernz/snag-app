// Asking the model about an email's papers — the network half of `bill.ts`.
//
// Shared by `inbound-bill` (a forwarded email arriving) and `reread-bill` (the
// *Read again* button on a card that came in blank), so the two cannot drift
// about how a paper is read. Everything that decides what a reading *means* is
// in `bill.ts`, pure and under jest; this only makes the requests.
//
// **Every paper is its own request, and they go together.** Read in turn, ten
// papers would be ten model calls end to end, and a webhook's background work
// and the app's *Read again* both have a deadline. In parallel the email costs
// about what one paper does. Each request walks the same busy-model fallback
// read-label does — demand is per model, so the next one may answer — inside
// one shared budget.

import { GEMINI_ENDPOINT, isBusy, modelsToTry, readingFromGemini } from '../read-label/gemini.ts';
import { paperFromReading, paperRequest, type PaperContext, type PaperReading } from './bill.ts';

/** A paper ready to send: its bytes as base64, its type, and its name. */
export interface PaperFile {
  mimeType: string;
  base64: string;
  name: string;
}

export interface ReadOutcome {
  /** One per file, in order; null where nothing usable came back. */
  readings: (PaperReading | null)[];
  /** The email's own words, read only when there were no files. */
  fromEmail: PaperReading | null;
  /** Some paper was refused because every model was busy — worth trying again. */
  busy: boolean;
  /** The key is missing or refused, on every model alike. */
  notSetUp: boolean;
}

const EARLY_ATTEMPT_MS = 40_000;
const MIN_ATTEMPT_MS = 8_000;
const BUSY_PAUSE_MS = 1_000;

/**
 * Reads every file, or the email's words when there are none.
 *
 * `budgetMs` is the whole allowance: the webhook's background work has longer
 * than the app waits on *Read again*, so each caller says how long it has.
 */
export async function readPapers(
  files: PaperFile[],
  email: { from: string | null; subject: string | null; text: string | null },
  household: string[],
  budgetMs: number,
  tag: string,
): Promise<ReadOutcome> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    return { readings: files.map(() => null), fromEmail: null, busy: false, notSetUp: true };
  }

  const models = modelsToTry(Deno.env.get('GEMINI_MODEL'), Deno.env.get('GEMINI_FALLBACK_MODEL'));
  const deadline = Date.now() + budgetMs;
  const state = { busy: false, notSetUp: false };
  const names = files.map((file) => file.name);

  const context = (fileName: string | null): PaperContext => ({
    ...email,
    fileName,
    otherFiles: fileName === null ? [] : names.filter((name) => name !== fileName),
    household,
  });

  if (files.length === 0) {
    if (!email.text) return { readings: [], fromEmail: null, busy: false, notSetUp: false };
    const fromEmail = await readOne(apiKey, models, JSON.stringify(paperRequest(null, context(null))), deadline, state, tag);
    return { readings: [], fromEmail, ...state };
  }

  const readings = await Promise.all(
    files.map((file) => readOne(
      apiKey, models, JSON.stringify(paperRequest(file, context(file.name))), deadline, state, `${tag} ${file.name}`,
    )),
  );
  return { readings, fromEmail: null, ...state };
}

async function readOne(
  apiKey: string,
  models: string[],
  body: string,
  deadline: number,
  state: { busy: boolean; notSetUp: boolean },
  tag: string,
): Promise<PaperReading | null> {
  for (const [index, model] of models.entries()) {
    const left = deadline - Date.now();
    if (left < MIN_ATTEMPT_MS) break;
    const last = index === models.length - 1;
    try {
      const answer = await fetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body,
        signal: AbortSignal.timeout(last ? left : Math.min(left, EARLY_ATTEMPT_MS)),
      });
      if (!answer.ok) {
        const detail = (await answer.text().catch(() => '')).slice(0, 300);
        console.error(`${tag}: ${model} ${answer.status}:`, detail);
        if (isBusy(answer.status)) {
          state.busy = true;
          if (!last) await new Promise((resolve) => setTimeout(resolve, BUSY_PAUSE_MS));
          continue;
        }
        if (answer.status === 401 || answer.status === 403 || /API key/i.test(detail)) state.notSetUp = true;
        return null;
      }
      const outcome = readingFromGemini(await answer.json().catch(() => null));
      if (!outcome.ok) {
        console.error(`${tag}: no reading —`, outcome.reason);
        return null;
      }
      return paperFromReading(outcome.reading);
    } catch (err) {
      // Too slow or unreachable is a kind of busy: the next model may answer.
      console.error(`${tag}: ${model} unreachable or too slow:`, err);
      state.busy = true;
    }
  }
  return null;
}
