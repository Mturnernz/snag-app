import { contrastRatio } from '../lib/tileInk';
import { DEFAULT_SCHEME, SCHEMES, SCHEME_ORDER, isSchemeId } from './schemes';

// Every colour scheme is held to the default's floors. A scheme is a matter of
// taste; whether the words on it can be read is not.

const INK = '#141413';
const GRAPHITE = '#57564F';
const PENCIL = '#6A6962';
const STATES = { slate: '#35526E', brass: '#825611', clay: '#9E3522' };

describe.each(SCHEME_ORDER.map((id) => [id]))('the %s scheme', (id) => {
  const s = SCHEMES[id];

  it('puts white words on its filled buttons at 4.5:1 or better', () => {
    expect(contrastRatio('#FFFFFF', s.primary)).toBeGreaterThanOrEqual(4.5);
  });

  it('can be read as a link on the ground, a well, white and its own tint', () => {
    for (const ground of [s.bone, s.well, '#FFFFFF', s.tint]) {
      expect(contrastRatio(s.primary, ground)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('reads as the action on ink, in a toast', () => {
    expect(contrastRatio(s.bright, INK)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps every ink readable on its ground and its well', () => {
    for (const ground of [s.bone, s.well]) {
      expect(contrastRatio(INK, ground)).toBeGreaterThanOrEqual(12);
      expect(contrastRatio(GRAPHITE, ground)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(PENCIL, ground)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the state hues readable on its ground, so open, doing and overdue mean the same thing', () => {
    for (const hue of Object.values(STATES)) {
      expect(contrastRatio(hue, s.bone)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('is named for the You tab', () => {
    expect(s.id).toBe(id);
    expect(s.label.length).toBeGreaterThan(0);
  });
});

describe('the list of schemes', () => {
  it('offers fern first, as the default, then the five asked for', () => {
    expect(SCHEME_ORDER).toEqual(['fern', 'blue', 'orange', 'silver', 'metallic', 'bronze']);
    expect(DEFAULT_SCHEME).toBe('fern');
  });

  it('knows its own ids and nothing else', () => {
    expect(isSchemeId('bronze')).toBe(true);
    expect(isSchemeId('purple')).toBe(false);
    expect(isSchemeId(null)).toBe(false);
  });
});
