import { relativeDay } from './relativeDay';

// Notes said when they were written through the phone's locale, so a phone in
// US English read month-first in a day-first app. These pin the words.
describe('relativeDay', () => {
  const now = new Date(2026, 10, 15, 10, 0); // Sunday 15 November 2026, local

  it('says today and yesterday', () => {
    expect(relativeDay(new Date(2026, 10, 15, 8).toISOString(), now)).toBe('Today');
    expect(relativeDay(new Date(2026, 10, 14, 23, 30).toISOString(), now)).toBe('Yesterday');
  });

  it('names the weekday inside the last week', () => {
    expect(relativeDay(new Date(2026, 10, 11, 9).toISOString(), now)).toBe('Wednesday');
  });

  it('writes an older date day first, whatever the locale', () => {
    expect(relativeDay(new Date(2026, 9, 3, 9).toISOString(), now)).toBe('03/10/2026');
  });

  it('keeps an evening on its own local day', () => {
    expect(relativeDay(new Date(2026, 10, 14, 21).toISOString(), now)).toBe('Yesterday');
  });

  it('writes a date ahead of today as a date', () => {
    expect(relativeDay(new Date(2026, 10, 20, 9).toISOString(), now)).toBe('20/11/2026');
  });
});
