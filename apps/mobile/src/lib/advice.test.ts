import { quoteBrief, snagQuoteTable } from '@snag/supabase-queries';
import type { Snag } from '../types';

// What leaves the app when jobs are sent for a quote. (The assessment brief and
// its paste-back parser were pinned here until October 2026, when the loop went.)

const snag = (over: Partial<Snag>): Snag => ({
  id: 'x', reference: 'SNAG-0001', householdId: 'h', propertyId: 'p',
  linkedThings: [],
  room: null, photoPaths: [], description: null, status: 'open',
  needsParts: false, parts: [], bought: [], dueAt: null, repeatDays: null,
  thingId: null, thingName: null, thingMake: null, thingModel: null,
  projectId: null, projectName: null,
  projectItemId: null, projectItemName: null, projectElementName: null,
  reporterId: 'me', reporterName: 'Me', propertyName: 'Home',
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
  lastDoneAt: null, doneAt: null, commentCount: 0,
  ...over,
});

// Jobs sent for a quote go to somebody the household may never have met, by
// WhatsApp. The file carries the work and nothing about who lives there.
describe('a PDF sent for a quote', () => {
  const job = (over: Partial<Snag>): Snag => ({
    id: 'a', reference: 'SNAG-0042', householdId: 'h', propertyId: 'p', room: 'Kitchen',
    photoPaths: ['h/1.jpg', 'h/2.jpg'], description: 'Rangehood filter', status: 'open', parts: ['Filter'],
    reporterName: 'Mike Turner', propertyName: '32 Le Roy', commentCount: 0,
    linkedThings: [{ id: 't1', name: 'Rangehood', room: 'Kitchen', make: 'Bosch', model: 'DWB97', kind: 'appliance' }],
    ...over,
  } as Snag);

  it('names the work, the room and the appliance, and nobody', () => {
    const table = snagQuoteTable([job({})], { where: 'Mount Eden, Auckland', stamp: '5 Oct 2026' });
    expect(table.columns).toEqual(['Reference', 'What', 'Room', 'About', 'Parts', 'Photos']);
    expect(table.rows[0]).toEqual(['SNAG-0042', 'Rangehood filter', 'Kitchen', 'Rangehood Bosch DWB97', 'Filter', '2']);
    const everything = JSON.stringify(table);
    expect(everything).not.toContain('Mike');
    expect(everything).not.toContain('Le Roy');
    expect(table.subtitle).toBe('Mount Eden, Auckland · 1 job · 5 Oct 2026');
  });

  it('carries the notes only when they were asked for', () => {
    const table = snagQuoteTable([job({})], { where: null, stamp: 's', notes: { a: ['Ordered it', 'Tuesday'] } });
    expect(table.columns[table.columns.length - 1]).toBe('Notes');
    expect(table.rows[0][table.rows[0].length - 1]).toBe('Ordered it / Tuesday');
  });

  it('asks for a price per reference, the callout apart, and says where only by suburb', () => {
    const brief = quoteBrief({ where: 'Mount Eden, Auckland', stamp: '5 Oct 2026', rowCount: 3, photoCount: 4 });
    const words = [brief.title, ...brief.blocks.flatMap((b) => [b.heading ?? '', ...b.lines])].join(' ');
    expect(brief.title).toBe('Could you quote for these jobs?');
    expect(words).toContain('3 jobs around a house in Mount Eden, Auckland');
    expect(words).toContain('4 photographs follow');
    expect(words).toMatch(/callout fee separately/);
    expect(words).toMatch(/reference/);
    expect(quoteBrief({ where: null, stamp: 's', rowCount: 1, photoCount: 0 }).title).toBe('Could you quote for this job?');
  });
});
