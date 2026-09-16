import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import DateField, { CalendarSheet } from './DateField';
import { formatDayFirst, parseLooseDate } from '@snag/supabase-queries';

/**
 * Typing a date, and tapping one.
 *
 * The failure this is built against is a date that is silently wrong rather
 * than visibly missing: a warranty filed three months out is not something
 * anybody re-reads until the day it matters.
 */

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const byLabel = (r: ReturnType<typeof render>, label: string) =>
  r.root.findAll(
    (n: any) => typeof n.type !== 'string' && n.props?.accessibilityLabel === label
      && !!n.props?.onPress,
    { deep: true }
  )[0];

describe('what somebody types', () => {
  it('reads 8/11/2019 as the eighth of November', () => {
    // Day first, always — this is a New Zealand household app. Read as
    // month-first it is the eleventh of August, and nothing on screen would
    // ever say which one it took.
    expect(parseLooseDate('8/11/2019')).toBe('2019-11-08');
    expect(parseLooseDate('08/11/2019')).toBe('2019-11-08');
    expect(parseLooseDate('8-11-2019')).toBe('2019-11-08');
  });

  it('still reads every form it read before', () => {
    expect(parseLooseDate('2019')).toBe('2019-01-01');
    expect(parseLooseDate('2019-11')).toBe('2019-11-01');
    expect(parseLooseDate('11/2019')).toBe('2019-11-01');
    expect(parseLooseDate('Nov 2019')).toBe('2019-11-01');
    expect(parseLooseDate('8 Nov 2019')).toBe('2019-11-08');
    expect(parseLooseDate('2019-11-08')).toBe('2019-11-08');
  });

  it('keeps month-only precision, which no calendar can express', () => {
    // The reason the typed box is not a fallback: "Nov 2019" is an honest
    // answer for a villa's wiring, and a picker would force a day nobody knows.
    expect(parseLooseDate('Nov 2019')).toBe('2019-11-01');
  });

  it('refuses a day that is not on the calendar rather than passing it on', () => {
    // A real `date` column raises 22008 from inside an RPC, which surfaces to
    // somebody who thought they answered the question.
    expect(parseLooseDate('31/02/2026')).toBeUndefined();
    expect(parseLooseDate('2019-13-45')).toBeUndefined();
    expect(parseLooseDate('32/01/2026')).toBeUndefined();
  });

  it('refuses a two-digit year rather than guessing a century', () => {
    // 8/11/98 is 1998 on a villa's wiring and 2098 on nothing at all. Saying so
    // is recoverable; a silently wrong century is not.
    expect(parseLooseDate('8/11/98')).toBeUndefined();
  });

  it('round-trips what the calendar writes back into the box', () => {
    // The two halves of one control. If these ever disagreed, tapping a day and
    // then leaving the field would change the answer.
    const iso = '2026-09-20';
    expect(formatDayFirst(iso)).toBe('20/09/2026');
    expect(parseLooseDate(formatDayFirst(iso))).toBe(iso);
  });
});

describe('the field', () => {
  it('offers a calendar beside the box rather than instead of it', () => {
    const r = render(
      <DateField label="Installed" value="" onChangeValue={jest.fn()} />
    );
    // Both halves present: the box takes loose precision, the calendar takes a
    // day. Removing either one loses an answer somebody needs to give.
    expect(
      r.root.findAll(
        (n: any) => typeof n.type !== 'string' && n.props?.accessibilityLabel === 'Installed'
          && !!n.props?.onChangeText,
        { deep: true }
      )[0]
    ).toBeDefined();
    expect(byLabel(r, 'Pick installed from a calendar')).toBeDefined();
  });

  it('carries no example value, because the calendar already says what it wants', () => {
    const r = render(<DateField label="Installed" value="" onChangeValue={jest.fn()} />);
    const box = r.root.findAll(
      (n: any) => typeof n.type !== 'string' && n.props?.accessibilityLabel === 'Installed'
        && !!n.props?.onChangeText,
      { deep: true }
    )[0];
    expect(box.props.placeholder).toBeUndefined();
  });

  it('writes a tapped day back as dd/mm/yyyy', () => {
    const onChangeValue = jest.fn();
    const r = render(
      <DateField label="Dated" value="" onChangeValue={onChangeValue} />
    );
    TestRenderer.act(() => byLabel(r, 'Pick dated from a calendar').props.onPress());
    const cell = r.root.findAll(
      (n: any) => typeof n.type !== 'string'
        && n.props?.accessibilityLabel === new Date(2026, 8, 20).toDateString()
        && !!n.props?.onPress,
      { deep: true }
    )[0];
    expect(cell).toBeDefined();
    TestRenderer.act(() => cell.props.onPress());
    expect(onChangeValue).toHaveBeenCalledWith('20/09/2026');
  });
});

describe('the calendar', () => {
  it('opens on the month of the date already set, not on today', () => {
    // Somebody correcting a date lands beside it rather than in today, paging
    // back four years to reach a warranty from 2022.
    const r = render(
      <CalendarSheet visible selected="2022-03-14" onPick={jest.fn()} onClose={jest.fn()} />
    );
    r.getByText('March 2022');
  });

  it('gives a tapped square the same local day it shows', () => {
    // The suite runs under TZ=Pacific/Auckland. `toISOString().slice(0, 10)`
    // would file a September evening here under the next day for half the year,
    // which is the bug `dayKey` exists for — so this is a real assertion rather
    // than one that happens to hold on a UTC runner.
    const onPick = jest.fn();
    const r = render(
      <CalendarSheet visible selected="2026-09-20" onPick={onPick} onClose={jest.fn()} />
    );
    const cell = r.root.findAll(
      (n: any) => typeof n.type !== 'string'
        && n.props?.accessibilityLabel === new Date(2026, 8, 20).toDateString()
        && !!n.props?.onPress,
      { deep: true }
    )[0];
    TestRenderer.act(() => cell.props.onPress());
    expect(onPick).toHaveBeenCalledWith('2026-09-20');
  });

  it('pages a month without losing what is selected', () => {
    const r = render(
      <CalendarSheet visible selected="2026-09-20" onPick={jest.fn()} onClose={jest.fn()} />
    );
    r.getByText('September 2026');
    TestRenderer.act(() => byLabel(r, 'Next month').props.onPress());
    r.getByText('October 2026');
    TestRenderer.act(() => byLabel(r, 'Previous month').props.onPress());
    TestRenderer.act(() => byLabel(r, 'Previous month').props.onPress());
    r.getByText('August 2026');
  });

  it('starts its week on Monday, as the Schedule tab does', () => {
    // Both draw `monthGrid`, whose lead-in is Monday-based. Two month grids
    // built two ways drift at exactly the edges nobody tests.
    const r = render(
      <CalendarSheet visible selected="2026-09-20" onPick={jest.fn()} onClose={jest.fn()} />
    );
    const weekdays = r.getAllByType('Text')
      .map((n) => n.children.join(''))
      .filter((t) => t.length === 1 && 'MTWFS'.includes(t));
    expect(weekdays.slice(0, 7)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
  });
});
