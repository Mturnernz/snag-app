import { countActiveOffscreen, describeFilteredEmptyState } from './filterSummary';

describe('countActiveOffscreen', () => {
  // A bar 200 wide, scrolled to the start, with four 60-wide chips laid out
  // end to end: two fully visible, one straddling the edge, one past it.
  const layouts = {
    scope: { x: 0, width: 60 },
    status: { x: 60, width: 60 },
    date: { x: 120, width: 60 },   // 120–180, midpoint 150 — visible
    site: { x: 180, width: 60 },   // 180–240, midpoint 210 — off
  };

  it('counts an active chip scrolled off the right edge', () => {
    const count = countActiveOffscreen(
      [{ key: 'scope', active: false }, { key: 'site', active: true }],
      layouts, 0, 200
    );
    expect(count).toBe(1);
  });

  it('ignores chips that are off screen but not active', () => {
    expect(countActiveOffscreen([{ key: 'site', active: false }], layouts, 0, 200)).toBe(0);
  });

  it('ignores active chips the reader can already see', () => {
    expect(countActiveOffscreen([{ key: 'scope', active: true }], layouts, 0, 200)).toBe(0);
  });

  // The reason for the midpoint rule: a chip cut in half by the edge is not
  // something you can read an active style off.
  it('counts a chip as off once more than half of it is past the edge', () => {
    expect(countActiveOffscreen([{ key: 'date', active: true }], layouts, 0, 149)).toBe(1);
    expect(countActiveOffscreen([{ key: 'date', active: true }], layouts, 0, 151)).toBe(0);
  });

  it('stops counting a chip once it has been scrolled into view', () => {
    expect(countActiveOffscreen([{ key: 'site', active: true }], layouts, 60, 200)).toBe(0);
  });

  it('says nothing before the bar has been measured', () => {
    expect(countActiveOffscreen([{ key: 'site', active: true }], layouts, 0, 0)).toBe(0);
    expect(countActiveOffscreen([{ key: 'nope', active: true }], layouts, 0, 200)).toBe(0);
  });
});

describe('describeFilteredEmptyState', () => {
  it('names one status and one site', () => {
    expect(describeFilteredEmptyState(['Flagged'], ['Hendo'])).toBe('No Flagged snags at Hendo');
  });

  it('names two of either', () => {
    expect(describeFilteredEmptyState(['Flagged', 'Resolved'], [])).toBe('No Flagged or Resolved snags');
    expect(describeFilteredEmptyState([], ['Hendo', 'Yard'])).toBe('No snags at Hendo or Yard');
  });

  it('counts sites past two rather than listing them', () => {
    expect(describeFilteredEmptyState(['Flagged'], ['Hendo', 'Yard', 'Depot']))
      .toBe('No Flagged snags at 3 sites');
  });

  // Only four statuses exist and three are on by default, so three or more
  // selected is close enough to "everything" that naming them is a long title
  // carrying no information.
  it('drops the status list past two, keeping whatever else is worth saying', () => {
    expect(describeFilteredEmptyState(['Flagged', 'Resolved', 'RCA Pending'], ['Hendo']))
      .toBe('No snags at Hendo');
    expect(describeFilteredEmptyState(['Flagged', 'Resolved', 'RCA Pending'], [])).toBeNull();
  });

  it('returns null when there is nothing worth naming', () => {
    expect(describeFilteredEmptyState([], [])).toBeNull();
  });
});
