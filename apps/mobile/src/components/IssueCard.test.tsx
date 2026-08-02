import React from 'react';
import { render } from '../test/render';
import { Snag } from '../types';
import { CardAlertBorder, CardAlertGlyph } from '../constants/theme';
import IssueCard from './IssueCard';

// The card's bottom edge is the crowded part. Three things want to sit on it —
// the severity glyph, the site pill, and the "new since your last visit" dot —
// and on a 110px compact photo any two of them positioned independently land
// on top of each other. These specs pin the two rules that keeps honest: every
// overlay lives in the same row, and the glyph exists at all.

const snag = (over: Partial<Snag>): Snag => ({
  id: 'snag-1',
  reference: 'SNAG-00001',
  status: 'flagged',
  kind: 'fixit',
  severity: null,
  description: 'A thing',
  created_at: '2026-08-01T00:00:00.000Z',
  site_name: 'Hendo',
  comment_count: 0,
  vote_score: 0,
  ...over,
} as Snag);

const glyphNames = Object.values(CardAlertGlyph);

const glyphOn = (root: ReturnType<typeof render>['root']) =>
  glyphNames.filter((name) => root.findAllByProps({ name }).length > 0);

describe('IssueCard alert glyph', () => {
  // The alert border was the one place on the card where colour carried a
  // meaning on its own, which the rest of the design system forbids outright.
  // The glyph is the second signal; a different one per border colour, since
  // three identical marks in three colours is the same failure again.
  it.each([
    ['injury' as const, { severity: 'injury' as const }],
    ['critical' as const, { severity: 'critical' as const }],
    ['improvement' as const, { kind: 'improvement' as const }],
  ])('gives the %s border a glyph of its own', (alert, fields) => {
    const { root } = render(<IssueCard issue={snag(fields)} onPress={() => {}} />);

    expect(glyphOn(root)).toEqual([CardAlertGlyph[alert]]);
    expect(root.findAllByProps({ color: CardAlertBorder[alert] }).length).toBeGreaterThan(0);
  });

  it('leaves an ordinary snag unmarked, so the glyph keeps meaning something', () => {
    const { root } = render(<IssueCard issue={snag({})} onPress={() => {}} />);
    expect(glyphOn(root)).toEqual([]);
  });

  // Severity outranks kind: an injury filed as an improvement is an injury.
  it('shows only the severity glyph when both would apply', () => {
    const { root } = render(
      <IssueCard issue={snag({ severity: 'injury', kind: 'improvement' })} onPress={() => {}} />
    );
    expect(glyphOn(root)).toEqual([CardAlertGlyph.injury]);
  });
});

describe('IssueCard "new" badge', () => {
  it('marks a card the list says is new', () => {
    const { getByText } = render(<IssueCard issue={snag({})} isNew onPress={() => {}} />);
    expect(getByText('NEW')).toBeTruthy();
  });

  it('says nothing by default', () => {
    const { queryByText } = render(<IssueCard issue={snag({})} onPress={() => {}} />);
    expect(queryByText('NEW')).toBeNull();
  });
});

describe('IssueCard photo footer', () => {
  // All three at once is the case that used to collide: a centred site pill
  // wide enough to read runs straight through both corners.
  it('keeps the glyph, the site pill and the new badge in one row', () => {
    const { getByText, root } = render(
      <IssueCard issue={snag({ severity: 'injury', site_name: 'Hendo' })} isNew compact onPress={() => {}} />
    );

    expect(getByText('Hendo')).toBeTruthy();
    expect(getByText('NEW')).toBeTruthy();
    expect(glyphOn(root)).toEqual([CardAlertGlyph.injury]);
  });

  it('still renders the site pill on a card with neither', () => {
    const { getByText } = render(<IssueCard issue={snag({})} onPress={() => {}} />);
    expect(getByText('Hendo')).toBeTruthy();
  });
});
