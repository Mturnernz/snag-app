import { isNewSince } from './snagFreshness';

const VISIT = '2026-08-01T09:00:00.000Z';
const BEFORE = '2026-08-01T08:00:00.000Z';
const AFTER = '2026-08-01T10:00:00.000Z';

const ME = 'user-me';
const SOMEONE = 'user-them';

describe('isNewSince', () => {
  it('marks a snag filed after the last visit', () => {
    expect(isNewSince({ created_at: AFTER, reporter_id: SOMEONE }, VISIT, ME)).toBe(true);
  });

  it('leaves a snag filed before the last visit alone', () => {
    expect(isNewSince({ created_at: BEFORE, reporter_id: SOMEONE }, VISIT, ME)).toBe(false);
  });

  it('treats a snag filed at the exact visit timestamp as already seen', () => {
    expect(isNewSince({ created_at: VISIT, reporter_id: SOMEONE }, VISIT, ME)).toBe(false);
  });

  // The one that would make the badge useless: with nothing stored, every snag
  // in the org is newer than "never", so a first-run grid would come up
  // entirely marked.
  it('marks nothing on a first visit', () => {
    expect(isNewSince({ created_at: AFTER, reporter_id: SOMEONE }, null, ME)).toBe(false);
  });

  // The default scope is "Relevant to me", which includes everything you
  // raised — so without this the reporter's own fresh report is the loudest
  // card on their own list.
  it('never marks your own report as new to you', () => {
    expect(isNewSince({ created_at: AFTER, reporter_id: ME }, VISIT, ME)).toBe(false);
  });

  it('still marks other people\'s snags when nobody is signed in yet', () => {
    expect(isNewSince({ created_at: AFTER, reporter_id: SOMEONE }, VISIT, null)).toBe(true);
  });

  it('marks nothing when either timestamp is missing or unparseable', () => {
    expect(isNewSince({ created_at: null, reporter_id: SOMEONE }, VISIT, ME)).toBe(false);
    expect(isNewSince({ created_at: 'not a date', reporter_id: SOMEONE }, VISIT, ME)).toBe(false);
    expect(isNewSince({ created_at: AFTER, reporter_id: SOMEONE }, 'not a date', ME)).toBe(false);
  });
});
