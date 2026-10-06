import {
  codeIsForThisSize, htmlText, isMakersSite, lookupFromGemini, lookupRequest, LOOKUP_SYSTEM, mentionsModel, monthsSaid,
  pageHas, pdfStreams, pdfStrings, registeredLabel, urlsToOpen, verifyLookup, type LookupClaims, type Page,
} from '../../../../supabase/functions/lookup-product/lookup';
import {
  monthsToDays, parseProductFacts, parseProductLookup, partLine, productOffers,
} from '@snag/supabase-queries';
import type { Thing } from '../types';

// `lookup-product` replaced a model's memory with a search, and the search is
// not trusted either. These pin the check that stands between a search result
// and somebody's shopping list: the maker's own site, the page opened by the
// function itself, this model named on it, and the value written on it.
//
// The fixtures are the heat pump that started this: a Mitsubishi Electric
// MSZ-GS60VFD, whose four label reads on 27 September 2026 suggested
// MAC-2370FT-E (sold for the FT/AP/HR range, not the GS), MAC-3000FT-E,
// MAC-EMF52FT-E (found nowhere) and, twice, "Air cleaning filter" with no
// number at all.

const MAKE = 'Mitsubishi Electric';
const MODEL = 'MSZ-GS60VFD';
const NZ_PAGE = 'https://www.mitsubishi-electric.co.nz/heatpump/i/69337B/gs60-standard-high-wall-heat-pump';
const MANUAL = 'https://www.mitsubishielectric.com.au/wp-content/uploads/2022/02/User_Manual-MSZ-GS25-80VFD-A1_OM_JG79Y822H02.pdf';
const RETAILER = 'https://hesatek.fi/en/products/silver-ionized-air-purifying-filter-ft-ap-hr-models-mac-2370ft-e';

const html = (url: string, words: string): Page => ({ finalUrl: url, kind: 'html', text: words });
const pdf = (url: string, words: string): Page => ({ finalUrl: url, kind: 'pdf', text: words });
const claims = (over: Partial<LookupClaims> = {}): LookupClaims => ({ manualUrl: null, parts: [], service: null, ...over });

describe('whose site it is', () => {
  it.each([
    ['https://www.mitsubishi-electric.co.nz/heatpump', 'mitsubishi-electric'],
    ['https://daikin.com.au/x', 'daikin'],
    ['https://media3.bosch-home.com/Documents/x.pdf', 'bosch-home'],
    ['https://www.samsung.com/nz/', 'samsung'],
  ])('reads the registered name of %p as %p', (url, label) => {
    expect(registeredLabel(new URL(url).hostname)).toBe(label);
  });

  it.each([
    [MAKE, NZ_PAGE],
    [MAKE, MANUAL],
    ['Fisher & Paykel', 'https://www.fisherpaykel.com/nz/'],
    ['Bosch', 'https://media3.bosch-home.com/Documents/manual.pdf'],
    ['Rinnai', 'https://rinnai.co.nz/products'],
    ['LG', 'https://www.lg.com/nz/'],
    ["De'Longhi", 'https://www.delonghi.com/en-nz'],
  ])('counts %p on %p', (make, url) => {
    expect(isMakersSite(make, url)).toBe(true);
  });

  it.each([
    [MAKE, RETAILER],
    [MAKE, 'https://www.mitsubishiparts.co.nz/filters'],
    [MAKE, 'https://www.amazon.com/Mitsubishi-MAC-2370FT-E'],
    [MAKE, 'https://myfiltercompany.com/collections/mitsubishi-air-filters'],
    ['Daikin', 'https://daikinfilters.com.au/x'],
    [MAKE, 'ftp://mitsubishi-electric.co.nz/x'],
    [MAKE, 'not a url'],
  ])('refuses %p on %p', (make, url) => {
    expect(isMakersSite(make, url)).toBe(false);
  });
});

describe('whether a page is about this model', () => {
  it('finds the model however the page spaces it', () => {
    expect(mentionsModel('Model MSZ-GS60VFD-A1 standard', MODEL)).toBe(true);
    expect(mentionsModel('msz gs60 vfd', MODEL)).toBe(true);
  });

  it('counts a range or a list that includes it', () => {
    expect(mentionsModel('User_Manual-MSZ-GS25-80VFD-A1_OM.pdf', MODEL)).toBe(true);
    expect(mentionsModel('MSZ-GS25/35/42/50/60VFD', MODEL)).toBe(true);
  });

  it('does not count a range that stops short, or another range altogether', () => {
    expect(mentionsModel('MSZ-GS25-50VFD', MODEL)).toBe(false);
    expect(mentionsModel('MSZ-AP25-80VGK', MODEL)).toBe(false);
    expect(mentionsModel('FT/AP/HR models', MODEL)).toBe(false);
  });
});

describe('what a sentence says about servicing', () => {
  it.each([
    ['Have the unit inspected by your dealer once a year.', 12],
    ['We recommend a service every 12 months.', 12],
    ['Service every two years by a qualified technician.', 24],
    ['Twice a year, have it checked by the installer.', 6],
  ])('reads %p as %p months', (sentence, months) => {
    expect(monthsSaid(sentence)).toBe(months);
  });

  it('reads nothing into "periodically"', () => {
    expect(monthsSaid('Have the unit inspected periodically.')).toBeNull();
  });
});

describe('verifyLookup', () => {
  const nzPage = html(NZ_PAGE, 'MSZ-GS60VFD-A1 GS60 Standard High Wall Heat Pump. Optional Plasma Quad Connect MAC-100FT-E.');

  it('keeps a part only from the maker’s page, written there, for this model', () => {
    const said = claims({
      parts: [
        { item: 'Plasma Quad Connect', code: 'MAC-100FT-E', url: NZ_PAGE },
        // The retailer that sells it for another range: not the maker's site.
        { item: 'Air cleaning filter', code: 'MAC-2370FT-E', url: RETAILER },
        // Claimed on the maker's page, but not written on it.
        { item: 'Air purifying filter', code: 'MAC-EMF52FT-E', url: NZ_PAGE },
      ],
    });
    const facts = verifyLookup(MAKE, MODEL, said, { [NZ_PAGE]: nzPage, [RETAILER]: html(RETAILER, 'MAC-2370FT-E FT/AP/HR') });
    expect(facts.parts).toEqual([
      { item: 'Plasma Quad Connect', code: 'MAC-100FT-E', url: NZ_PAGE, source: 'mitsubishi-electric.co.nz' },
    ]);
  });

  // The GS manual's own words, as the function reads them out of the PDF: one
  // filter code for most sizes, and the GS71/80's own after it.
  const FILTERS = 'Note: (Anti-Allergy Enzyme Filter, option) Clean every 3 months: When dirt cannot be removed by vacuum cleaning: Every year: MAC-408FT-E  GS71/80: MAC-2390FT-E  Important';

  it('keeps a part from a range manual only for the sizes it is printed for', () => {
    const said = (model: string) => verifyLookup(MAKE, model, claims({
      parts: [{ item: 'Anti-Allergy Enzyme Filter', code: 'MAC-408FT-E', url: MANUAL }],
    }), { [MANUAL]: pdf(MANUAL, FILTERS) }).parts.map((one) => one.code);
    expect(said('MSZ-GS60VFD')).toEqual(['MAC-408FT-E']);
    // The GS71 is labelled with a code of its own, so this one is not its.
    expect(said('MSZ-GS71VFD')).toEqual([]);
  });

  it.each([
    ['MAC-408FT-E', 'MSZ-GS60VFD', true],
    ['MAC-408FT-E', 'MSZ-GS71VFD', false],
    ['MAC-2390FT-E', 'MSZ-GS80VFD', true],
    ['MAC-2390FT-E', 'MSZ-GS35VFD', false],
  ])('reads %p as %s the %p', (code, model, want) => {
    expect(codeIsForThisSize(FILTERS, code, model)).toBe(want);
  });

  it('counts a code with no size labels near it as the whole range’s', () => {
    expect(codeIsForThisSize('Replacement filter: MAC-2370FT-E', 'MAC-2370FT-E', 'MSZ-AP50VGK')).toBe(true);
    expect(codeIsForThisSize('GS25-60: MAC-408FT-E', 'MAC-408FT-E', 'MSZ-GS60VFD')).toBe(true);
    expect(codeIsForThisSize('GS25-50: MAC-408FT-E', 'MAC-408FT-E', 'MSZ-GS60VFD')).toBe(false);
  });

  it('keeps nothing from a page the function did not open itself', () => {
    const said = claims({ parts: [{ item: 'Plasma Quad Connect', code: 'MAC-100FT-E', url: NZ_PAGE }] });
    expect(verifyLookup(MAKE, MODEL, said, {}).parts).toEqual([]);
  });

  it('keeps nothing from a page that redirected off the maker’s site', () => {
    const said = claims({ parts: [{ item: 'Plasma Quad Connect', code: 'MAC-100FT-E', url: NZ_PAGE }] });
    const moved = html('https://parts-reseller.example/mac-100ft-e', nzPage.text);
    expect(verifyLookup(MAKE, MODEL, said, { [NZ_PAGE]: moved }).parts).toEqual([]);
  });

  it('keeps nothing from a maker’s page about another model', () => {
    const said = claims({ parts: [{ item: 'Air cleaning filter', code: 'MAC-2370FT-E', url: NZ_PAGE }] });
    const other = html(NZ_PAGE, 'MSZ-AP50VGK air cleaning filter MAC-2370FT-E');
    expect(verifyLookup(MAKE, MODEL, said, { [NZ_PAGE]: other }).parts).toEqual([]);
  });

  it('never keeps a part with no number, or the model’s own number', () => {
    const said = claims({
      parts: [
        { item: 'Air cleaning filter', code: 'Air filter', url: NZ_PAGE },
        { item: 'Heat pump', code: 'MSZ-GS60VFD', url: NZ_PAGE },
      ],
    });
    expect(verifyLookup(MAKE, MODEL, said, { [NZ_PAGE]: nzPage }).parts).toEqual([]);
  });

  it('keeps a range manual by its file name, even when its text cannot be read', () => {
    const facts = verifyLookup(MAKE, MODEL, claims({ manualUrl: MANUAL }), { [MANUAL]: pdf(MANUAL, '') });
    expect(facts.manual).toEqual({ url: MANUAL, source: 'mitsubishielectric.com.au' });
  });

  it('keeps a service interval only when the page says it, about servicing, at the interval claimed', () => {
    const quote = 'Have the unit inspected by your dealer once a year.';
    const manual = pdf(MANUAL, `MSZ-GS25-80VFD ... ${quote} ...`);
    const ok = verifyLookup(MAKE, MODEL, claims({ service: { months: 12, quote, url: MANUAL } }), { [MANUAL]: manual });
    expect(ok.service).toMatchObject({ months: 12, source: 'mitsubishielectric.com.au' });

    // The interval claimed is not the one the sentence says.
    expect(verifyLookup(MAKE, MODEL, claims({ service: { months: 6, quote, url: MANUAL } }), { [MANUAL]: manual }).service)
      .toBeNull();
    // The sentence is not on the page.
    expect(verifyLookup(MAKE, MODEL, claims({ service: { months: 12, quote, url: MANUAL } }), { [MANUAL]: pdf(MANUAL, 'MSZ-GS25-80VFD') }).service)
      .toBeNull();
    // Cleaning a filter yourself is not a service.
    const cleaning = 'Clean the air filters every 2 weeks.';
    const withCleaning = pdf(MANUAL, `MSZ-GS25-80VFD ${cleaning}`);
    expect(verifyLookup(MAKE, MODEL, claims({ service: { months: 1, quote: cleaning, url: MANUAL } }), { [MANUAL]: withCleaning }).service)
      .toBeNull();
  });

  it('opens only the maker’s pages, once each', () => {
    const said = claims({
      manualUrl: MANUAL,
      parts: [
        { item: 'a', code: 'MAC-100FT-E', url: NZ_PAGE },
        { item: 'b', code: 'MAC-2370FT-E', url: RETAILER },
        { item: 'c', code: 'MAC-3000FT-E', url: NZ_PAGE },
      ],
    });
    expect(urlsToOpen(MAKE, said)).toEqual([MANUAL, NZ_PAGE]);
  });
});

describe('the request and the reply', () => {
  it('searches and opens pages, and asks for the maker’s own words only', () => {
    const body = lookupRequest(MAKE, MODEL, 'Heat pump');
    expect(body.tools).toEqual([{ google_search: {} }, { url_context: {} }]);
    expect(body.contents[0].parts[0].text).toMatch(/Model: MSZ-GS60VFD/);
    expect(LOOKUP_SYSTEM).toMatch(/Retailers, spare-parts shops/);
    expect(LOOKUP_SYSTEM).toMatch(/Never complete or adjust a part number/);
    expect(LOOKUP_SYSTEM).toMatch(/Returning nothing is normal and correct/);
  });

  const reply = (text: string, over: Record<string, unknown> = {}) => ({
    candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP', ...over }],
  });

  it('reads the object out of prose around it, and drops a part without its page', () => {
    const outcome = lookupFromGemini(reply(
      'Here is what I found:\n```json\n' + JSON.stringify({
        manualUrl: MANUAL,
        parts: [{ item: 'Filter', code: 'MAC-100FT-E', url: NZ_PAGE }, { item: 'Filter', code: 'X1' }],
        service: { months: 12, quote: 'once a year', url: MANUAL },
      }) + '\n```',
    ));
    expect(outcome).toEqual({
      ok: true,
      claims: {
        manualUrl: MANUAL,
        parts: [{ item: 'Filter', code: 'MAC-100FT-E', url: NZ_PAGE }],
        service: { months: 12, quote: 'once a year', url: MANUAL },
      },
    });
  });

  it.each([
    ['a blocked prompt', { promptFeedback: { blockReason: 'SAFETY' } }, 'blocked'],
    ['an answer cut off', reply('{"manualUrl":', { finishReason: 'MAX_TOKENS' }), 'truncated'],
    ['no candidates', { candidates: [] }, 'empty'],
    ['prose with no object', reply('I could not find anything.'), 'unparseable'],
  ])('tells apart %s', (_, raw, reason) => {
    expect(lookupFromGemini(raw)).toEqual({ ok: false, reason });
  });
});

describe('reading pages', () => {
  it('drops scripts and tags, and decodes entities', () => {
    expect(htmlText('<p>MAC&#45;100FT&#8209;E</p><script>var x = "MAC-9";</script> &amp; more')).toBe('MAC-100FT‑E & more');
  });

  it('finds a part number however the page spaces it', () => {
    expect(pageHas('Filter: MAC 100FT E', 'MAC-100FT-E')).toBe(true);
    expect(pageHas('MAC-2370FT-E', 'MAC-100FT-E')).toBe(false);
  });

  it('finds a PDF’s text streams and skips its images', () => {
    const file = '<< /Length 10 /Filter /FlateDecode >>\nstream\nxxxx\nendstream\n<< /Subtype /Image /Filter /FlateDecode >>\nstream\nyyyy\nendstream\n<< /Length 4 >>\nstream\nzzzz\nendstream';
    expect(pdfStreams(file).map((one) => one.flate)).toEqual([true, false]);
  });

  it('reads the strings a content stream draws, and ignores glyph noise', () => {
    expect(pdfStrings('BT (MSZ-GS60VFD) Tj [(MAC-) -20 (100FT-E)] TJ ET')).toBe('MSZ-GS60VFDMAC-100FT-E');
    expect(pdfStrings('(\\001\\002\\003) Tj')).toBe('');
  });
});

describe('what the thing’s page is offered', () => {
  const thing = (over: Partial<Thing> = {}): Thing => ({
    id: 't', householdId: 'h', propertyId: 'p', kind: 'appliance',
    name: 'Heat pump', room: 'Living room', photoPaths: [], documentPaths: [],
    make: MAKE, model: MODEL, serial: null, consumables: [],
    installedAt: null, warrantyUntil: null, serviceDays: null, spec: {}, notes: null,
    createdBy: 'me', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
    propertyName: 'Home', snagCount: 0, openSnagCount: 0,
    ...over,
  });
  const facts = {
    manual: { url: MANUAL, source: 'mitsubishielectric.com.au' },
    service: { months: 12, quote: 'once a year', url: MANUAL, source: 'mitsubishielectric.com.au' },
    parts: [{ item: 'Plasma Quad Connect', code: 'MAC-100FT-E', url: NZ_PAGE, source: 'mitsubishi-electric.co.nz' }],
  };

  it('offers a part until its number is on the list, however the line was written', () => {
    expect(productOffers(thing(), facts).parts).toHaveLength(1);
    const taken = productOffers(thing({ consumables: ['mac100fte'] }), facts);
    expect(taken.parts).toEqual([]);
    expect(taken.taken).toHaveLength(1);
    expect(partLine(facts.parts[0])).toBe('Plasma Quad Connect MAC-100FT-E');
  });

  it('offers the interval only while nothing is arranged, in the app’s own days', () => {
    expect(productOffers(thing(), facts).service?.days).toBe(365);
    expect(productOffers(thing({ serviceDays: 180 }), facts).service).toBeNull();
    expect(monthsToDays(6)).toBe(180);
    expect(monthsToDays(24)).toBe(730);
  });

  it('reads a kept answer defensively: a value with no web address is dropped', () => {
    const got = parseProductFacts({
      manual: { url: 'javascript:alert(1)', source: 'x' },
      service: { months: 1.5, quote: 'q', url: MANUAL },
      parts: [{ item: 'Filter', code: 'MAC-100FT-E', url: NZ_PAGE }, { item: 'Filter', code: 'X', url: '' }],
    });
    expect(got?.manual).toBeNull();
    expect(got?.service).toBeNull();
    expect(got?.parts).toEqual([
      { item: 'Filter', code: 'MAC-100FT-E', url: NZ_PAGE, source: 'mitsubishi-electric.co.nz' },
    ]);
  });

  it('reads a found answer with nothing in it as nothing', () => {
    const lookup = parseProductLookup({ id: 'l', status: 'found', result: { manual: null, parts: [] }, make: MAKE, model: MODEL });
    expect(lookup?.status).toBe('nothing');
    expect(lookup?.facts).toBeNull();
    expect(parseProductLookup({ id: 'l', status: 'failed', reason: 'weird' })?.reason).toBe('error');
    expect(parseProductLookup({ id: 'l', status: 'failed', reason: 'limit' })?.reason).toBe('limit');
    expect(parseProductLookup({ id: 'l', status: 'invented' })).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// What a lookup came to: found, nothing, or a failure that can be asked again.

import { claimsAreEmpty, decideLookup, describeReply } from '../../../../supabase/functions/lookup-product/lookup';

describe('decideLookup', () => {
  const nzPage = html(NZ_PAGE, 'MSZ-GS60VFD-A1 GS60 Standard High Wall Heat Pump. Optional Plasma Quad Connect MAC-100FT-E.');
  const SERVICE = 'Have the unit inspected by your dealer once a year.';
  const manualPage = pdf(MANUAL, `MSZ-GS25-80VFD ... ${SERVICE} ...`);

  it('is found with a manual alone', () => {
    const decision = decideLookup(MAKE, MODEL, claims({ manualUrl: MANUAL }), { [MANUAL]: manualPage });
    expect(decision).toMatchObject({ status: 'found', facts: { manual: { url: MANUAL }, parts: [], service: null } });
  });

  it('is found with parts alone', () => {
    const decision = decideLookup(MAKE, MODEL, claims({ parts: [{ item: 'Plasma Quad Connect', code: 'MAC-100FT-E', url: NZ_PAGE }] }), { [NZ_PAGE]: nzPage });
    expect(decision).toMatchObject({ status: 'found', facts: { manual: null, service: null } });
  });

  it('is found with a service interval alone', () => {
    const decision = decideLookup(MAKE, MODEL, claims({ service: { months: 12, quote: SERVICE, url: MANUAL } }), { [MANUAL]: manualPage });
    expect(decision).toMatchObject({ status: 'found', facts: { manual: null, parts: [], service: { months: 12 } } });
  });

  it('keeps what verified when another claim did not, each judged on its own', () => {
    const decision = decideLookup(MAKE, MODEL, claims({
      manualUrl: MANUAL,
      parts: [
        { item: 'Plasma Quad Connect', code: 'MAC-100FT-E', url: NZ_PAGE },
        { item: 'Invented', code: 'MAC-999FT-E', url: NZ_PAGE },
      ],
      service: { months: 6, quote: SERVICE, url: MANUAL },
    }), { [MANUAL]: manualPage, [NZ_PAGE]: nzPage });
    expect(decision).toMatchObject({
      status: 'found',
      facts: { manual: { url: MANUAL }, service: null, parts: [{ code: 'MAC-100FT-E' }] },
    });
  });

  it('is a failure that can be asked again when the model claims nothing at all', () => {
    expect(decideLookup(MAKE, MODEL, claims(), {})).toEqual({ status: 'failed', reason: 'error', why: 'no_claims' });
    // Saying it could not find anything is not saying the maker has none.
    expect(decideLookup(MAKE, MODEL, claims({ outcome: 'could_not_find' }), {})).toMatchObject({ status: 'failed', why: 'no_claims' });
  });

  it('is a failure when every claim is rejected', () => {
    const decision = decideLookup(MAKE, MODEL, claims({
      parts: [{ item: 'Air cleaning filter', code: 'MAC-2370FT-E', url: NZ_PAGE }],
    }), { [NZ_PAGE]: nzPage });
    expect(decision).toEqual({ status: 'failed', reason: 'error', why: 'unverified' });
  });

  it('is a failure when the maker’s pages would not open', () => {
    const decision = decideLookup(MAKE, MODEL, claims({ manualUrl: MANUAL }), {});
    expect(decision).toEqual({ status: 'failed', reason: 'error', why: 'sources_unavailable' });
  });

  it('is a failure when the claims name only pages that are not the maker’s', () => {
    const decision = decideLookup(MAKE, MODEL, claims({ parts: [{ item: 'Filter', code: 'MAC-2370FT-E', url: RETAILER }] }), {});
    expect(decision).toMatchObject({ status: 'failed' });
  });

  describe('nothing', () => {
    const none = (checkedUrls: string[]) => claims({ outcome: 'none_published', checkedUrls });

    it('needs the model to say so and a maker page this function opened about this model', () => {
      expect(decideLookup(MAKE, MODEL, none([NZ_PAGE]), { [NZ_PAGE]: nzPage })).toEqual({ status: 'nothing' });
    });

    it('is not believed when the page could not be opened', () => {
      expect(decideLookup(MAKE, MODEL, none([NZ_PAGE]), {})).toMatchObject({ status: 'failed' });
    });

    it('is not believed when the page is about another model', () => {
      const other = html(NZ_PAGE, 'MSZ-AP50VGK air cleaning filter');
      expect(decideLookup(MAKE, MODEL, none([NZ_PAGE]), { [NZ_PAGE]: other })).toMatchObject({ status: 'failed' });
    });

    it('is not believed when the page is not the maker’s, or redirected off its site', () => {
      expect(decideLookup(MAKE, MODEL, none([RETAILER]), { [RETAILER]: html(RETAILER, nzPage.text) })).toMatchObject({ status: 'failed' });
      const moved = html('https://parts-reseller.example/x', nzPage.text);
      expect(decideLookup(MAKE, MODEL, none([NZ_PAGE]), { [NZ_PAGE]: moved })).toMatchObject({ status: 'failed' });
    });

    it('is not believed when the model only says it could not find it', () => {
      expect(decideLookup(MAKE, MODEL, claims({ outcome: 'could_not_find', checkedUrls: [NZ_PAGE] }), { [NZ_PAGE]: nzPage }))
        .toMatchObject({ status: 'failed' });
    });
  });
});

describe('the reply’s own words about itself', () => {
  it('reads outcome and the pages checked, and ignores anything else', () => {
    const outcome = lookupFromGemini({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ outcome: 'None_Published', manualUrl: null, parts: [], service: null, checkedUrls: [NZ_PAGE, 7, ''] }) }] } }],
    });
    expect(outcome).toEqual({ ok: true, claims: { manualUrl: null, parts: [], service: null, outcome: 'none_published', checkedUrls: [NZ_PAGE] } });
    const odd = lookupFromGemini({ candidates: [{ content: { parts: [{ text: '{"outcome":"sure","manualUrl":null}' }] } }] });
    expect(odd).toEqual({ ok: true, claims: { manualUrl: null, parts: [], service: null } });
  });

  it('opens the pages it says it checked, with the rest', () => {
    expect(urlsToOpen(MAKE, claims({ manualUrl: MANUAL, checkedUrls: [NZ_PAGE, RETAILER] }))).toEqual([MANUAL, NZ_PAGE]);
    expect(claimsAreEmpty(claims({ checkedUrls: [NZ_PAGE] }))).toBe(false);
    expect(claimsAreEmpty(claims())).toBe(true);
  });

  it('describes a reply without carrying any of its words', () => {
    const line = describeReply({
      candidates: [{
        finishReason: 'STOP',
        content: { parts: [{ text: 'MAC-100FT-E' }, { thought: true, text: 'hidden' }, { executableCode: {} }] },
        groundingMetadata: { groundingChunks: [{}, {}, {}] },
        urlContextMetadata: { urlMetadata: [{}] },
      }],
    });
    expect(line).toBe(
      'blockReason=none candidates=1 finishReason=STOP parts=3 textParts=1 thoughtParts=1 otherParts=executableCode ' +
        'textChars=11 grounding=true groundingChunks=3 urlContext=true urlsRead=1',
    );
    expect(line).not.toMatch(/MAC-100|hidden/);
    expect(describeReply(null)).toMatch(/candidates=0 finishReason=none parts=0/);
  });

  it('asks for structured output only when told to, and keeps the search tools either way', () => {
    const plain = lookupRequest(MAKE, MODEL, null);
    const structured = lookupRequest(MAKE, MODEL, null, { structured: true });
    expect('generationConfig' in plain).toBe(false);
    expect(structured.generationConfig).toMatchObject({ responseMimeType: 'application/json' });
    expect(structured.tools).toEqual([{ google_search: {} }, { url_context: {} }]);
    expect(LOOKUP_SYSTEM).toMatch(/could not find this.*does not publish this/);
  });
});
