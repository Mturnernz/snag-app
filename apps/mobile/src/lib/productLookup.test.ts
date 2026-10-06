import {
  candidateUrls, codeIsForThisSize, documentLinks, excerpt, htmlText, isMakersSite, mentionsModel, monthsSaid, pageHas,
  pageLinks, pagesToRead, PAGE_CHARS, READ_SYSTEM, readFromGemini, readRequest, registeredLabel, SEARCH_SYSTEM,
  searchFromGemini, searchRequest, verifyLookup, type LookupClaims, type Page,
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
    ['https://media3.bsh-group.com/Documents/x.pdf', 'bsh-group'],
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
    // The group's own document servers, named one by one.
    ['Bosch', 'https://media3.bsh-group.com/Documents/9002017220_A.pdf'],
    ['Neff', 'https://media3.bsh-group.com/Documents/x.pdf'],
    ['LG', 'https://gscs.lge.com/downloadFile?fileId=x'],
    ['Mitsubishi Heavy Industries', 'https://www.mhiaa.com.au/x.pdf'],
  ])('counts %p on %p', (make, url) => {
    expect(isMakersSite(make, url)).toBe(true);
  });

  it.each([
    [MAKE, RETAILER],
    [MAKE, 'https://www.mitsubishiparts.co.nz/filters'],
    [MAKE, 'https://www.amazon.com/Mitsubishi-MAC-2370FT-E'],
    [MAKE, 'https://myfiltercompany.com/collections/mitsubishi-air-filters'],
    ['Daikin', 'https://daikinfilters.com.au/x'],
    // A group domain is the group's makers', and nobody else's.
    ['Samsung', 'https://media3.bsh-group.com/Documents/x.pdf'],
    ['Daikin', 'https://gscs.lge.com/x'],
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
});

describe('finding the pages', () => {
  it('searches with Google Search alone, briefly, and asks for addresses as the search gave them', () => {
    const body = searchRequest(MAKE, MODEL, 'Heat pump');
    expect(body.tools).toEqual([{ google_search: {} }]);
    expect(body.generationConfig).toEqual({ thinkingConfig: { thinkingLevel: 'low' } });
    expect('generationConfig' in searchRequest(MAKE, MODEL, null, { lean: true })).toBe(false);
    expect(body.contents[0].parts[0].text).toMatch(/Model: MSZ-GS60VFD/);
    expect(body.contents[0].parts[0].text).toMatch(/What it is: Heat pump/);
    expect(SEARCH_SYSTEM).toMatch(/Not retailers, spare-parts shops/);
    expect(SEARCH_SYSTEM).toMatch(/Never build, shorten or guess an address/);
  });

  const reply = (text: string, over: Record<string, unknown> = {}) => ({
    candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP', ...over }],
  });

  it('reads the list out of prose, and adds the pages the search returned', () => {
    const outcome = searchFromGemini(reply(
      'Here you are:\n```json\n' + JSON.stringify({ pages: [{ url: MANUAL, what: 'Manual' }, { url: 'not a url' }, { url: NZ_PAGE }] }) + '\n```',
      {
        groundingMetadata: {
          webSearchQueries: ['MSZ-GS60VFD manual', 'MSZ-GS60VFD filter'],
          groundingChunks: [{ web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc', title: 'mitsubishi-electric.co.nz' } }, { retrievedContext: {} }],
        },
      },
    ));
    expect(outcome).toEqual({
      ok: true,
      found: {
        listed: [{ url: MANUAL, what: 'manual' }, { url: NZ_PAGE, what: 'other' }],
        grounded: [{ url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc', title: 'mitsubishi-electric.co.nz' }],
        queries: 2,
      },
    });
  });

  it('takes the addresses written in prose when there is no list', () => {
    const outcome = searchFromGemini(reply(`The manual is at ${MANUAL}. The product page is ${NZ_PAGE}, I think.`));
    expect(outcome).toMatchObject({ ok: true, found: { listed: [{ url: MANUAL }, { url: NZ_PAGE }] } });
  });

  it.each([
    ['a blocked prompt', { promptFeedback: { blockReason: 'SAFETY' } }, 'blocked'],
    ['an answer cut off', reply('{"pages":', { finishReason: 'MAX_TOKENS' }), 'truncated'],
    ['no candidates', { candidates: [] }, 'empty'],
    ['no words at all', reply(''), 'empty'],
  ])('tells apart %s', (_, raw, reason) => {
    expect(searchFromGemini(raw)).toEqual({ ok: false, reason });
  });

  it('opens the manual first, then the rest, and never a retailer', () => {
    const found = {
      listed: [{ url: NZ_PAGE, what: 'product' }, { url: RETAILER, what: 'parts' }, { url: MANUAL, what: 'manual' }],
      grounded: [],
      queries: 1,
    };
    expect(candidateUrls(MAKE, found)).toEqual([MANUAL, NZ_PAGE]);
  });

  it('follows Google’s redirects, unless the result already says it is somebody else’s site', () => {
    const redirect = (id: string) => `https://vertexaisearch.cloud.google.com/grounding-api-redirect/${id}`;
    const found = {
      listed: [{ url: MANUAL, what: 'manual' }],
      grounded: [
        { url: redirect('maker'), title: 'mitsubishi-electric.co.nz' },
        { url: redirect('shop'), title: 'hesatek.fi' },
        { url: redirect('untitled'), title: null },
        { url: redirect('page-title'), title: 'GS60 Standard High Wall Heat Pump' },
        { url: MANUAL, title: 'mitsubishielectric.com.au' },
      ],
      queries: 1,
    };
    expect(candidateUrls(MAKE, found)).toEqual([MANUAL, redirect('maker'), redirect('untitled'), redirect('page-title')]);
  });
});

describe('reading the pages', () => {
  const pages = [
    { url: MANUAL, kind: 'pdf' as const, text: 'MSZ-GS25-80VFD ... Parts Number GS25/35/50/60: MAC-408FT-E' },
    { url: NZ_PAGE, kind: 'html' as const, text: '' },
  ];

  it('shows the read every page by number, with nothing to search with, and asks for what the pages state', () => {
    const body = readRequest(MAKE, MODEL, 'Heat pump', pages);
    expect('tools' in body).toBe(false);
    const asked = body.contents[0].parts[0].text;
    expect(asked).toMatch(/\[1\] https:\/\/www\.mitsubishielectric\.com\.au\/.*\(PDF\)\nMSZ-GS25-80VFD/);
    expect(asked).toMatch(/\[2\] https:\/\/www\.mitsubishi-electric\.co\.nz\/.*\(web page\)\n\(Its text could not be read/);
    expect(body.generationConfig).toMatchObject({ responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' } });
    expect('generationConfig' in readRequest(MAKE, MODEL, null, pages, { lean: true })).toBe(false);
    expect(READ_SYSTEM).toMatch(/Use only the text of the numbered pages/);
    expect(READ_SYSTEM).toMatch(/copied character for character/);
    expect(READ_SYSTEM).toMatch(/Returning nothing is normal and correct/);
  });

  const said = (json: unknown) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] }, finishReason: 'STOP' }] });

  it('turns page numbers into the addresses this function opened, and drops a number that is not one of them', () => {
    const outcome = readFromGemini(said({
      manual: 1,
      parts: [
        { item: 'Air cleaning filter', code: 'MAC-408FT-E', page: 1 },
        { item: 'Invented', code: 'MAC-999FT-E', page: 7 },
        { item: 'No page', code: 'MAC-1FT-E' },
      ],
      service: { months: 12, quote: 'Have it inspected once a year.', page: 2 },
    }), pages);
    expect(outcome).toEqual({
      ok: true,
      claims: {
        manualUrl: MANUAL,
        parts: [{ item: 'Air cleaning filter', code: 'MAC-408FT-E', url: MANUAL }],
        service: { months: 12, quote: 'Have it inspected once a year.', url: NZ_PAGE },
      },
    });
    expect(readFromGemini(said({ manual: 0, parts: [], service: null }), pages)).toEqual({
      ok: true, claims: { manualUrl: null, parts: [], service: null },
    });
  });

  it.each([
    ['prose with no object', { candidates: [{ content: { parts: [{ text: 'I found nothing.' }] } }] }, 'unparseable'],
    ['no words', { candidates: [{ content: { parts: [] } }] }, 'empty'],
    ['a blocked answer', { candidates: [{ finishReason: 'RECITATION' }] }, 'blocked'],
  ])('tells apart %s', (_, raw, reason) => {
    expect(readFromGemini(raw, pages)).toEqual({ ok: false, reason });
  });

  it('shows a long page as its opening and what is near the words for parts and servicing', () => {
    const filler = 'Lorem ipsum dolor sit amet. '.repeat(4000);
    const page = `COVER MSZ-GS25-80VFD ${filler} Parts Number GS25/35/50/60: MAC-408FT-E ${filler} Have it inspected by your dealer once a year. ${filler}`;
    const shown = excerpt(page);
    expect(shown.length).toBeLessThanOrEqual(PAGE_CHARS);
    expect(shown).toMatch(/^COVER MSZ-GS25-80VFD/);
    expect(shown).toMatch(/MAC-408FT-E/);
    expect(shown).toMatch(/inspected by your dealer once a year/);
    expect(shown).toMatch(/ … /);
    expect(excerpt('short page')).toBe('short page');
  });
});

describe('reading a web page', () => {
  it('drops scripts and tags, decodes entities, and keeps a product’s structured description', () => {
    expect(htmlText('<p>MAC&#45;100FT&#8209;E</p><script>var x = "MAC-9";</script> &amp; more')).toBe('MAC-100FT‑E & more');
    expect(htmlText('<h1>Heat pump</h1><script type="application/ld+json">{"sku":"MSZ-GS60VFD"}</script>')).toMatch(/MSZ-GS60VFD/);
  });

  it('finds a part number however the page spaces it', () => {
    expect(pageHas('Filter: MAC 100FT E', 'MAC-100FT-E')).toBe(true);
    expect(pageHas('MAC-2370FT-E', 'MAC-100FT-E')).toBe(false);
  });

  it('lists its links as absolute addresses with their words, and the PDFs its scripts name', () => {
    const html = '<a href="/docs/User_Manual.pdf#p2" class="x">Download <b>user manual</b></a>'
      + '<a href=\'https://www.mitsubishi-electric.co.nz/gs60\'>GS60</a><a href="mailto:x@y.z">mail</a>'
      + '<script>window.data = {"om":"https:\\/\\/www.mitsubishi-electric.co.nz\\/files\\/OM_GS.pdf"}</script>';
    expect(pageLinks(html, NZ_PAGE)).toEqual([
      { url: 'https://www.mitsubishi-electric.co.nz/docs/User_Manual.pdf', text: 'Download user manual' },
      { url: 'https://www.mitsubishi-electric.co.nz/gs60', text: 'GS60' },
      { url: 'https://www.mitsubishi-electric.co.nz/files/OM_GS.pdf', text: '' },
    ]);
  });
});

describe('the second hop: what the maker’s pages link to', () => {
  const page = (links: { url: string; text: string }[]): Page => ({ finalUrl: NZ_PAGE, kind: 'html', text: 'GS60', links });
  const ON_SITE = 'https://www.mitsubishi-electric.co.nz';

  it('follows the maker’s manuals, best first, and nothing else', () => {
    const links = [
      { url: `${ON_SITE}/about-us`, text: 'About us' },
      { url: `${ON_SITE}/files/brochure.pdf`, text: 'Brochure' },
      { url: `${ON_SITE}/files/OM_AP.pdf`, text: 'Operating instructions' },
      { url: `${ON_SITE}/files/User_Manual-MSZ-GS25-80VFD.pdf`, text: 'User manual' },
      { url: 'https://www.manualslib.com/gs60.pdf', text: 'User manual' },
      { url: `${ON_SITE}/downloads/filters.pdf`, text: 'Replacement filters' },
    ];
    expect(documentLinks(MAKE, MODEL, [page(links)], new Set())).toEqual([
      `${ON_SITE}/files/User_Manual-MSZ-GS25-80VFD.pdf`,
      `${ON_SITE}/files/OM_AP.pdf`,
      `${ON_SITE}/downloads/filters.pdf`,
    ]);
  });

  it('does not open a page twice, and reads no links off a page that is not the maker’s', () => {
    const manual = `${ON_SITE}/files/User_Manual-MSZ-GS25-80VFD.pdf`;
    expect(documentLinks(MAKE, MODEL, [page([{ url: manual, text: 'User manual' }])], new Set([manual]))).toEqual([]);
    const elsewhere: Page = { finalUrl: RETAILER, kind: 'html', text: '', links: [{ url: manual, text: 'User manual' }] };
    expect(documentLinks(MAKE, MODEL, [elsewhere], new Set())).toEqual([]);
  });
});

describe('what the read is shown', () => {
  it('shows only the maker’s pages about this model, by their words or their address, documents first', () => {
    const shown = pagesToRead(MAKE, MODEL, [
      html(NZ_PAGE, 'MSZ-GS60VFD-A1 GS60 Standard High Wall Heat Pump'),
      html('https://www.mitsubishi-electric.co.nz/ap50', 'MSZ-AP50VGK'),
      html(RETAILER, 'MSZ-GS60VFD MAC-2370FT-E'),
      pdf(MANUAL, ''),
    ]);
    expect(shown.map((one) => one.finalUrl)).toEqual([MANUAL, NZ_PAGE]);
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
  // A page of the maker's, read through, about this model and long enough to have said something.
  const readThrough = pdf(MANUAL, `OPERATING INSTRUCTIONS MSZ-GS25VFD MSZ-GS35VFD MSZ-GS50VFD MSZ-GS60VFD ${'Clean the air filter every 2 weeks. '.repeat(20)}`);

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

  describe('nothing', () => {
    it('is the answer when a page of the maker’s about this model was read and stated none of it', () => {
      expect(decideLookup(MAKE, MODEL, claims(), { [MANUAL]: readThrough })).toEqual({ status: 'nothing' });
      // A claim that did not hold up on that page changes nothing.
      const wrong = claims({ parts: [{ item: 'Air cleaning filter', code: 'MAC-2370FT-E', url: MANUAL }] });
      expect(decideLookup(MAKE, MODEL, wrong, { [MANUAL]: readThrough })).toEqual({ status: 'nothing' });
    });

    it('is not said when the only page about this model was so by its address alone', () => {
      expect(decideLookup(MAKE, MODEL, claims(), { [MANUAL]: pdf(MANUAL, '') })).toEqual({ status: 'failed', reason: 'error', why: 'nothing_read' });
    });

    it('is not said over a page that is about another model, or too short to have said anything', () => {
      const other = html(NZ_PAGE, `MSZ-AP50VGK ${'air cleaning filter '.repeat(40)}`);
      expect(decideLookup(MAKE, MODEL, claims(), { [NZ_PAGE]: other })).toMatchObject({ status: 'failed' });
      expect(decideLookup(MAKE, MODEL, claims(), { [NZ_PAGE]: html(NZ_PAGE, 'MSZ-GS60VFD') })).toMatchObject({ status: 'failed' });
    });

    it('is not said over a page that is not the maker’s, or redirected off its site', () => {
      expect(decideLookup(MAKE, MODEL, claims(), { [RETAILER]: html(RETAILER, readThrough.text) })).toMatchObject({ status: 'failed' });
      const moved = pdf('https://parts-reseller.example/x', readThrough.text);
      expect(decideLookup(MAKE, MODEL, claims(), { [MANUAL]: moved })).toMatchObject({ status: 'failed' });
    });

    it('is a failure that can be asked again when nothing was read at all', () => {
      expect(decideLookup(MAKE, MODEL, claims(), {})).toEqual({ status: 'failed', reason: 'error', why: 'nothing_read' });
      expect(decideLookup(MAKE, MODEL, claims({ manualUrl: MANUAL }), {})).toEqual({ status: 'failed', reason: 'error', why: 'unverified' });
    });
  });
});

describe('the reply’s own words about itself', () => {
  it('knows a read that claimed nothing', () => {
    expect(claimsAreEmpty(claims())).toBe(true);
    expect(claimsAreEmpty(claims({ manualUrl: MANUAL }))).toBe(false);
  });

  it('describes a reply without carrying any of its words', () => {
    const line = describeReply({
      candidates: [{
        finishReason: 'STOP',
        content: { parts: [{ text: 'MAC-100FT-E' }, { thought: true, text: 'hidden' }, { executableCode: {} }] },
        groundingMetadata: { groundingChunks: [{}, {}, {}], webSearchQueries: ['a', 'b'] },
        urlContextMetadata: { urlMetadata: [{}] },
      }],
      usageMetadata: { promptTokenCount: 1234 },
    });
    expect(line).toBe(
      'blockReason=none candidates=1 finishReason=STOP parts=3 textParts=1 thoughtParts=1 otherParts=executableCode ' +
        'textChars=11 grounding=true searches=2 groundingChunks=3 urlContext=true urlsRead=1 tokensIn=1234',
    );
    expect(line).not.toMatch(/MAC-100|hidden/);
    expect(describeReply(null)).toMatch(/candidates=0 finishReason=none parts=0/);
  });
});
