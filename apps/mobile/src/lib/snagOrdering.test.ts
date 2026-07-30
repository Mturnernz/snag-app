import { sortSnags, needsAttention } from './snagOrdering';
import { Snag } from '../types';

// "The newest snag is the first card" is the rule this file exists to hold. It
// was broken by a well-meaning pin on unresolved injuries: filing into an org
// with an open injury put the new snag in slot two, which on a two-column grid
// is the top *right*. That is how it was reported, and it is what these tests
// stop coming back.

const snag = (over: Partial<Snag>): Snag => ({
  id: over.id ?? 'x',
  severity: null,
  status: 'flagged',
  vote_score: 0,
  comment_count: 0,
  ...over,
} as Snag);

describe('sortSnags', () => {
  it('leaves the database order alone on newest, so the newest row stays first', () => {
    const rows = [
      snag({ id: 'newest' }),
      // The card that used to jump the queue.
      snag({ id: 'open-injury', severity: 'injury', status: 'in_progress' }),
      snag({ id: 'older' }),
    ];

    expect(sortSnags(rows, 'newest').map((s) => s.id)).toEqual(['newest', 'open-injury', 'older']);
  });

  it('leaves the database order alone on oldest too', () => {
    const rows = [snag({ id: 'oldest' }), snag({ id: 'injury', severity: 'injury', status: 'flagged' })];
    expect(sortSnags(rows, 'oldest').map((s) => s.id)).toEqual(['oldest', 'injury']);
  });

  it('ranks by engagement on trending, the one sort where recency is not the rule', () => {
    const rows = [
      snag({ id: 'quiet', vote_score: 1, comment_count: 0 }),
      snag({ id: 'busy', vote_score: 4, comment_count: 9 }),
      snag({ id: 'middling', vote_score: 2, comment_count: 2 }),
    ];

    expect(sortSnags(rows, 'trending').map((s) => s.id)).toEqual(['busy', 'middling', 'quiet']);
  });

  it('does not mutate the array it was given', () => {
    const rows = [snag({ id: 'a', vote_score: 1 }), snag({ id: 'b', vote_score: 5 })];
    sortSnags(rows, 'trending');
    expect(rows.map((s) => s.id)).toEqual(['a', 'b']);
  });
});

describe('needsAttention', () => {
  it('picks out unresolved injuries and nothing else', () => {
    const rows = [
      snag({ id: 'open-injury', severity: 'injury', status: 'in_progress' }),
      snag({ id: 'resolved-injury', severity: 'injury', status: 'resolved' }),
      snag({ id: 'open-critical', severity: 'critical', status: 'flagged' }),
      snag({ id: 'niggle' }),
    ];

    expect(needsAttention(rows).map((s) => s.id)).toEqual(['open-injury']);
  });

  it('keeps the order it was given, so the strip is newest-first as well', () => {
    const rows = [
      snag({ id: 'newer', severity: 'injury', status: 'flagged' }),
      snag({ id: 'older', severity: 'injury', status: 'in_progress' }),
    ];
    expect(needsAttention(rows).map((s) => s.id)).toEqual(['newer', 'older']);
  });
});
