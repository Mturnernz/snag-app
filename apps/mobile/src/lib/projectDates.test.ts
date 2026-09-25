import { defaultStartDate, orderProjectDates } from '@snag/supabase-queries';

/**
 * A project's start and finish must not cross, and when they would, the box
 * somebody just changed wins and the other moves to meet it.
 */

describe('orderProjectDates', () => {
  it('moves the start back to a finish set before it', () => {
    expect(orderProjectDates('2026-09-26', '2024-06-25', 'finished'))
      .toEqual({ startedOn: '2024-06-25', finishedOn: '2024-06-25', moved: 'started' });
  });

  it('moves the finish forward to a start set after it', () => {
    expect(orderProjectDates('2026-10-10', '2026-09-01', 'started'))
      .toEqual({ startedOn: '2026-10-10', finishedOn: '2026-10-10', moved: 'finished' });
  });

  it('leaves an ordered pair alone, the same day included', () => {
    expect(orderProjectDates('2026-03-03', '2026-09-01', 'finished').moved).toBeNull();
    expect(orderProjectDates('2026-03-03', '2026-03-03', 'started').moved).toBeNull();
  });

  it('never orders against a missing date', () => {
    expect(orderProjectDates(null, '2024-06-25', 'finished'))
      .toEqual({ startedOn: null, finishedOn: '2024-06-25', moved: null });
    expect(orderProjectDates('2026-03-03', null, 'started'))
      .toEqual({ startedOn: '2026-03-03', finishedOn: null, moved: null });
  });

  it('compares across month and year boundaries as days, not as text lengths', () => {
    expect(orderProjectDates('2026-01-01', '2025-12-31', 'finished').moved).toBe('started');
    expect(orderProjectDates('2025-12-31', '2026-01-01', 'finished').moved).toBeNull();
  });
});

describe('defaultStartDate', () => {
  it('is today with no finish, or a finish still to come', () => {
    expect(defaultStartDate(null, '2026-09-25')).toBe('2026-09-25');
    expect(defaultStartDate('2026-10-01', '2026-09-25')).toBe('2026-09-25');
  });

  it('is the finish when the project already finished', () => {
    expect(defaultStartDate('2024-06-25', '2026-09-25')).toBe('2024-06-25');
  });
});
