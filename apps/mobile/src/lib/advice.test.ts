import {
  ACTIONS_FENCE, assessmentBrief, matchAdviceToSnags, parseSnagActions,
} from '@snag/supabase-queries';
import type { Snag } from '../types';

// The loop this pins is deliberately outside the app: a briefed PDF goes out, a
// reply comes back as text, and the app files it against the references it
// asked about. Two ends, and both of them fail quietly if nobody is watching —
// a brief that contradicts the file it is stapled to, and a paste that writes
// eleven of twelve answers without saying which one it dropped.

const brief = (over: Partial<Parameters<typeof assessmentBrief>[0]> = {}) => assessmentBrief({
  household: 'Turner', place: 'Home', where: 'Mount Eden, Auckland',
  scope: "What's on screen", stamp: '2026-09-15', rowCount: 7, photoCount: 5,
  ...over,
});

const allLines = (over?: Partial<Parameters<typeof assessmentBrief>[0]>): string =>
  brief(over).blocks.flatMap((block) => block.lines).join('\n');

const snag = (over: Partial<Snag>): Snag => ({
  id: 'x', reference: 'SNAG-0001', householdId: 'h', propertyId: 'p',
  linkedThings: [],
  room: null, photoPaths: [], description: null, status: 'open',
  needsParts: false, parts: [], bought: [], dueAt: null, repeatDays: null, assigneeId: null,
  thingId: null, thingName: null, thingMake: null, thingModel: null,
  projectId: null, projectName: null,
  projectItemId: null, projectItemName: null, projectElementName: null,
  reporterId: 'me', reporterName: 'Me', assigneeName: null, propertyName: 'Home',
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
  lastDoneAt: null, doneAt: null, commentCount: 0,
  ...over,
});

describe('the brief in the PDF', () => {
  it('names the scope the file was made under, and says to skip finished work', () => {
    // The chips already asked, and *everything* includes done snags. A brief
    // reading "review all open issues" over a file holding finished ones is the
    // document contradicting itself, and it spends half the answer on jobs
    // somebody already did.
    expect(allLines()).toContain("what's on screen");
    expect(allLines()).toMatch(/Skip any row whose Status reads Done/);
  });

  it('says where the house is, so a tradesman can be looked for near it', () => {
    expect(allLines()).toContain('Home, Mount Eden, Auckland');
  });

  it('still reads as a sentence when the place has never said where it is', () => {
    // Every other screen renders around a missing property location; the brief
    // has to as well, rather than printing "Home, null".
    // The prose, not the template block — that one carries a literal null
    // because "need_to_see" is usually empty.
    const prose = brief({ where: null }).blocks
      .filter((block) => !block.mono)
      .flatMap((block) => block.lines)
      .join('\n');
    expect(prose).toContain('a house at Home,');
    expect(prose).not.toContain('null');
  });

  it('demands a source for every tradesman and allows none to be found', () => {
    // The failure this exists for: three plausible names and three plausible
    // mobile numbers, indistinguishable at this end from real ones.
    const lines = allLines();
    expect(lines).toMatch(/address of the page you found it on/);
    expect(lines).toMatch(/say none found\. Do not fill the gap/);
  });

  it('rules out the work a householder legally cannot do', () => {
    const lines = allLines();
    for (const phrase of ['registered electrician', 'Gasfitting', 'Licensed Building Practitioner',
      'asbestos', 'Work at height']) {
      expect(lines).toContain(phrase);
    }
  });

  it('asks for the callout fee and the total separately', () => {
    expect(allLines()).toMatch(/to get them to the door, and the likely\s+total as a range/);
  });

  it('carries the fence the parser looks for, in a block of its own', () => {
    const block = brief().blocks.find((b) => b.mono);
    expect(block?.lines[0]).toBe('```' + ACTIONS_FENCE);
    // Mono because somebody copies it, and prose it is not.
    expect(block?.heading).toBeUndefined();
  });

  it('counts the photographs that are actually in the file, and says when none are', () => {
    expect(allLines({ photoCount: 1 })).toContain('1 photograph follows');
    expect(allLines({ photoCount: 0 })).toContain('no photographs in this file');
  });
});

describe('reading the reply back', () => {
  const reply = (body: string) => `Here's what I found.\n\n\`\`\`${ACTIONS_FENCE}\n${body}\n\`\`\`\n`;

  it('takes the answers out of the fenced block', () => {
    const { entries, error } = parseSnagActions(reply(JSON.stringify({
      'SNAG-0042': {
        diagnosis: 'Perished flush valve seal',
        verdict: 'diy',
        steps: ['Turn the water off', 'Swap the seal'],
        parts: [{ item: 'Flush valve seal', where: 'Mitre 10', approx_nzd: '12-18' }],
      },
    })));

    expect(error).toBeNull();
    expect(entries).toHaveLength(1);
    expect(entries[0].reference).toBe('SNAG-0042');
    expect(entries[0].verdict).toBe('diy');
    expect(entries[0].parts[0]).toEqual({
      item: 'Flush valve seal', where: 'Mitre 10', approxNzd: '12-18',
    });
  });

  it('throws away a tradesman with no source, and keeps the sourced one', () => {
    // The single rule worth the whole parser. An unsourced name is a phone
    // number nobody can account for sitting in a household's own list.
    const { entries } = parseSnagActions(reply(JSON.stringify({
      'SNAG-0042': {
        diagnosis: 'Cistern inlet is a plumbing job',
        verdict: 'trade',
        trade: 'plumber',
        tradies: [
          { name: 'Invented Plumbing', phone: '021 555 0000' },
          { name: 'Real Plumbing', phone: '09 555 1234', source: 'https://example.co.nz/real' },
        ],
      },
    })));

    expect(entries[0].tradies.map((t) => t.name)).toEqual(['Real Plumbing']);
  });

  it('keeps money as text, exactly as it arrived', () => {
    const { entries } = parseSnagActions(reply(JSON.stringify({
      'SNAG-0001': {
        diagnosis: 'Needs a sparky',
        verdict: 'trade',
        tradies: [{ name: 'A', source: 'https://x.nz', callout_nzd: '95', total_nzd: '180-260' }],
      },
    })));

    expect(entries[0].tradies[0].calloutNzd).toBe('95');
    expect(entries[0].tradies[0].totalNzd).toBe('180-260');
  });

  it('accepts a bare string as a part', () => {
    const { entries } = parseSnagActions(reply(JSON.stringify({
      'SNAG-0001': { diagnosis: 'Loose hinge', verdict: 'diy', parts: ['Wall plugs'] },
    })));
    expect(entries[0].parts).toEqual([{ item: 'Wall plugs', where: null, approxNzd: null }]);
  });

  it('files an unrecognised verdict as unclear rather than guessing', () => {
    const { entries } = parseSnagActions(reply(JSON.stringify({
      'SNAG-0001': { diagnosis: 'Hard to say', verdict: 'maybe' },
    })));
    expect(entries[0].verdict).toBe('unclear');
  });

  it('drops an entry that answered nothing', () => {
    // Applying it would stamp a date and a source onto a snag and tell the
    // household nothing at all.
    const { entries, error } = parseSnagActions(reply(JSON.stringify({
      'SNAG-0001': { verdict: 'diy' },
    })));
    expect(entries).toEqual([]);
    expect(error).toMatch(/no answers in it/);
  });

  it('says which of the three ways a paste fails, because the fixes differ', () => {
    expect(parseSnagActions('   ').error).toMatch(/Nothing pasted/);
    expect(parseSnagActions('It looks like a plumbing job to me.').error)
      .toMatch(new RegExp(`No ${ACTIONS_FENCE} block`));
    expect(parseSnagActions(reply('{ "SNAG-0001": { "diagnosis": "cut off')).error)
      .toMatch(/cut off part way/);
  });

  it('reads an unfenced block, and a json-fenced one', () => {
    const body = '{ "SNAG-0001": { "diagnosis": "Gutters full", "verdict": "diy" } }';
    expect(parseSnagActions(body).entries).toHaveLength(1);
    expect(parseSnagActions('Reply:\n```json\n' + body + '\n```').entries).toHaveLength(1);
  });

  it('takes an array that names its own references', () => {
    const { entries } = parseSnagActions(reply(JSON.stringify([
      { reference: 'snag-0007', diagnosis: 'Gutter joint leaking', verdict: 'diy' },
    ])));
    expect(entries[0].reference).toBe('SNAG-0007');
  });

  it('caps what one answer can carry', () => {
    const { entries } = parseSnagActions(reply(JSON.stringify({
      'SNAG-0001': {
        diagnosis: 'x'.repeat(2000),
        verdict: 'diy',
        steps: Array.from({ length: 30 }, (_, i) => `step ${i}`),
        parts: Array.from({ length: 40 }, (_, i) => ({ item: `part ${i}` })),
      },
    })));
    expect(entries[0].diagnosis).toHaveLength(600);
    expect(entries[0].steps).toHaveLength(8);
    expect(entries[0].parts).toHaveLength(20);
  });
});

describe('lining the answers up against the list', () => {
  it('matches on the reference, whatever case it came back in', () => {
    const snags = [snag({ id: 'a', reference: 'SNAG-0042' })];
    const { entries } = parseSnagActions('{ "snag-0042": { "diagnosis": "Perished seal" } }');
    const { matched, unknown } = matchAdviceToSnags(entries, snags);

    expect(matched).toHaveLength(1);
    expect(matched[0].snag.id).toBe('a');
    expect(unknown).toEqual([]);
  });

  it('names a reference it has never heard of rather than applying eleven of twelve', () => {
    // A job from another place, a job since deleted, or an invention — and all
    // three get the same answer: not written, and said out loud.
    const snags = [snag({ id: 'a', reference: 'SNAG-0042' })];
    const { entries } = parseSnagActions(JSON.stringify({
      'SNAG-0042': { diagnosis: 'Perished seal' },
      'SNAG-9999': { diagnosis: 'Something that is not on this list' },
    }));
    const { matched, unknown } = matchAdviceToSnags(entries, snags);

    expect(matched.map((m) => m.snag.id)).toEqual(['a']);
    expect(unknown).toEqual(['SNAG-9999']);
  });
});
