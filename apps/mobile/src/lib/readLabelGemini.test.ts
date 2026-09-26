import {
  DEFAULT_MODEL, FALLBACK_MODEL, LAST_RESORT_MODEL, geminiRequest, isBusy, modelsToTry, readingFromGemini, SCHEMA, SYSTEM,
} from '../../../../supabase/functions/read-label/gemini';
import { parseLabelReading } from '@snag/supabase-queries';

// `read-label` asks Gemini and the app never knows it did. What these pin is
// the seam: the request carries the photo and the fixed shape, and every way
// a reply can fail to be a reading is caught as one — so a blocked or cut-off
// answer becomes the sentence under the boxes, never half a model number.

const reply = (text: string, over: Record<string, unknown> = {}) => ({
  candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP', ...over }],
});

const plate = {
  legible: true, make: 'Smeg', model: 'C6GMXA8', serial: null, colourName: null,
  colourCode: null, product: null, sheen: null, tint: null, hex: null, consumables: [],
};

describe('the request', () => {
  it('sends the photo inline, asks for JSON in the fixed shape, and names the kind', () => {
    const body = geminiRequest('finish', 'image/jpeg', 'AAAA');
    expect(body.contents[0].parts[0]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'AAAA' } });
    expect(body.contents[0].parts[1].text).toMatch(/paint/);
    expect(body.generationConfig).toEqual({ responseMimeType: 'application/json', responseJsonSchema: SCHEMA });
    expect(body.systemInstruction.parts[0].text).toMatch(/Transcribe; do not infer/);
  });

  it('asks for every field, so a missing key never has to be told from a null', () => {
    expect([...SCHEMA.required].sort()).toEqual(Object.keys(SCHEMA.properties).sort());
  });

  it('asks for the brand in its own capitals, and fences what is suggested from what is read', () => {
    expect(SYSTEM).toMatch(/Mitsubishi Electric/);
    expect(SYSTEM).toMatch(/not transcription/);
    expect(SCHEMA.properties.suggestedConsumables.items.required).toEqual(['item', 'code']);
    // A swatch is the maker's published value or nothing — never read off the photo.
    expect(SYSTEM).toMatch(/published hex/);
    expect(SYSTEM).toMatch(/Never estimate it from the colour in the photo/);
  });

  it('asks what the thing is when nobody has said, and says what it is when somebody has', () => {
    expect(geminiRequest('', 'image/jpeg', 'x').contents[0].parts[1].text).toMatch(/Say what this is/);
    expect(geminiRequest('finish', 'image/jpeg', 'x').contents[0].parts[1].text).not.toMatch(/Say what this is/);
    // No enum: every field uses the one nullable-string shape the live reads
    // already prove Gemini accepts. The app keeps only the three kinds.
    expect(SCHEMA.properties.kindGuess).toEqual({ type: ['string', 'null'] });
    expect(SYSTEM).toMatch(/whatItIs: what the item is/);
  });

  it('treats an unknown kind as an appliance rather than sending nothing', () => {
    expect(geminiRequest('mystery', 'image/png', 'x').contents[0].parts[1].text).toMatch(/rating plate/);
  });
});

describe('reading the reply', () => {
  it('reads a clean answer, which the app then accepts', () => {
    const outcome = readingFromGemini(reply(JSON.stringify(plate)));
    expect(outcome).toEqual({ ok: true, reading: plate });
    expect(parseLabelReading(outcome.ok ? outcome.reading : null)).toMatchObject({ make: 'Smeg' });
  });

  it('ignores thought parts and forgives a code fence', () => {
    const raw = {
      candidates: [{
        finishReason: 'STOP',
        content: { parts: [{ text: 'looking at the plate', thought: true }, { text: '```json\n{"legible":false}\n```' }] },
      }],
    };
    expect(readingFromGemini(raw)).toEqual({ ok: true, reading: { legible: false } });
  });

  it.each([
    ['a blocked prompt', { promptFeedback: { blockReason: 'SAFETY' } }, 'blocked'],
    ['a filtered answer', reply('{}', { finishReason: 'SAFETY' }), 'blocked'],
    ['an answer cut off', reply('{"legible":true,"make":"Sm', { finishReason: 'MAX_TOKENS' }), 'truncated'],
    ['no candidates at all', { candidates: [] }, 'empty'],
    ['an empty answer', reply('   '), 'empty'],
    ['something that is not JSON', reply('The label says Smeg.'), 'unparseable'],
    ['nothing at all', null, 'empty'],
  ])('refuses %s', (_, raw, reason) => {
    expect(readingFromGemini(raw)).toEqual({ ok: false, reason });
  });
});

describe('asking a second model when the first is busy', () => {
  // The first live reads came back 503 "high demand" from the newest Flash
  // twice in a row, with the key, the photo and the count all fine.

  it('asks the default, the fallback, then Flash-Lite, and never one model twice', () => {
    expect(modelsToTry(undefined, undefined)).toEqual([DEFAULT_MODEL, FALLBACK_MODEL, LAST_RESORT_MODEL]);
    expect(modelsToTry('gemini-x', undefined)).toEqual(['gemini-x', FALLBACK_MODEL, LAST_RESORT_MODEL]);
    expect(modelsToTry(FALLBACK_MODEL, FALLBACK_MODEL)).toEqual([FALLBACK_MODEL, LAST_RESORT_MODEL]);
    expect(modelsToTry(LAST_RESORT_MODEL, undefined)).toEqual([LAST_RESORT_MODEL, FALLBACK_MODEL]);
    expect(modelsToTry('', '')).toEqual([DEFAULT_MODEL, FALLBACK_MODEL, LAST_RESORT_MODEL]);
  });

  it.each([503, 500, 429])('treats %i as busy, which another model may not be', (status) => {
    expect(isBusy(status)).toBe(true);
  });

  it.each([400, 401, 403, 404])('does not retry %i, which every model would refuse alike', (status) => {
    expect(isBusy(status)).toBe(false);
  });
});
