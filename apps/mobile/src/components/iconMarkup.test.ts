import fs from 'fs';
import path from 'path';
import { glyphFor } from './iconMarkup';
import { FROM_IONICONS, GLYPHS } from './snagLine';

/**
 * Four Ionicons names are also Snag Line glyph names, and the glyph wins:
 * `checkbox` was Ionicons' ticked box and is Snag Line's empty one. The room
 * picker and the linked-items picker asked for `checkbox` on a ticked row, so a
 * choice that had been made drew as an empty box in the chosen colour, and
 * read as a tap that did nothing (November 2026).
 *
 * The aliases come from the generated `snagLine.ts` and cannot apply. So no
 * screen may pass one of those names; it names the Snag Line glyph instead.
 */
const SHADOWED = Object.entries(FROM_IONICONS)
  .filter(([name, glyph]) => name in GLYPHS && name !== glyph)
  .map(([name]) => name);

describe('icon names', () => {
  it('draws a Snag Line glyph by its own name, before any Ionicons alias', () => {
    expect(glyphFor('checkbox')).toBe('checkbox');
    expect(GLYPHS[glyphFor('checkbox')]).not.toMatch(/<path/);
    expect(GLYPHS[glyphFor('checkbox-on')]).toMatch(/<path/);
  });

  it('knows which Ionicons names a glyph hides', () => {
    expect(SHADOWED).toEqual(expect.arrayContaining(['checkbox']));
  });

  it('never passes an icon a name a glyph hides', () => {
    const SRC = path.resolve(__dirname, '..');
    const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      const full = path.join(dir, d.name);
      if (d.isDirectory()) return files(full);
      return /\.tsx$/.test(d.name) && !/\.test\.tsx$/.test(d.name) ? [full] : [];
    });
    const offenders = files(SRC).flatMap((f) => {
      const text = fs.readFileSync(f, 'utf8');
      // Every `name=` on an <Icon>, braces or quotes, across lines.
      return [...text.matchAll(/<Icon\b[^>]*?\bname=(\{[^}]*\}|"[^"]*")/gs)]
        .flatMap((m) => [...m[1].matchAll(/['"]([a-z-]+)['"]/g)].map((s) => s[1]))
        .filter((name) => SHADOWED.includes(name))
        .map((name) => `${path.relative(SRC, f)}: ${name}`);
    });
    expect(offenders).toEqual([]);
  });
});
