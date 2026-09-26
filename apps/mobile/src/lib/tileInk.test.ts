import { Colors } from '../constants/theme';
import {
  TILE_MIN_CONTRAST, contrastRatio, relativeLuminance, tileInk, underScrim,
} from './tileInk';

// A room's tile is painted in whatever its main wall is, so the words on it
// are chosen per wall rather than once. These pin the arithmetic against known
// values and then the property that matters: there is no wall colour the words
// cannot be read on.

describe('the contrast arithmetic', () => {
  it('matches the WCAG endpoints', () => {
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });

  it('agrees with the pairs theme.ts says it measured', () => {
    // "ink on ground 13.85 · muted on sunken 5.31"
    expect(contrastRatio(Colors.textPrimary, Colors.background)).toBeCloseTo(13.85, 1);
    expect(contrastRatio(Colors.textMuted, Colors.sunken)).toBeCloseTo(5.31, 1);
  });

  it('reads a three-digit hex as its six-digit twin', () => {
    expect(relativeLuminance('#abc')).toBeCloseTo(relativeLuminance('#AABBCC'), 10);
  });
});

describe('the words on a painted tile', () => {
  it('is ink on a pale wall and white on a dark one', () => {
    // Wan White, and a forest green feature wall.
    expect(tileInk('#E4E2DC')).toEqual({ ink: Colors.textPrimary, scrim: false });
    expect(tileInk('#405341')).toEqual({ ink: Colors.white, scrim: false });
  });

  it('puts a panel behind the words on a mid-tone neither reads on', () => {
    const mid = '#777777';
    expect(Math.max(contrastRatio(mid, Colors.textPrimary), contrastRatio(mid, Colors.white)))
      .toBeLessThan(TILE_MIN_CONTRAST);
    expect(tileInk(mid)).toEqual({ ink: Colors.textPrimary, scrim: true });
  });

  it('can be read on every wall there is', () => {
    // Every colour a three-digit hex can name — 4096 walls, black to white.
    // Either the chosen words reach 4.5:1 on the wall itself, or they sit on
    // the panel and reach it there.
    const digits = '0123456789ABCDEF';
    const failures: string[] = [];
    for (const r of digits) for (const g of digits) for (const b of digits) {
      const wall = `#${r}${r}${g}${g}${b}${b}`;
      const { ink, scrim } = tileInk(wall);
      const ground = scrim ? underScrim(wall) : wall;
      if (contrastRatio(ground, ink) < TILE_MIN_CONTRAST) failures.push(wall);
    }
    expect(failures).toEqual([]);
  });
});
