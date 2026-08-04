import fs from 'fs';
import path from 'path';

/**
 * `expo-camera`'s web entry builds a QR-decoding Web Worker at module scope,
 * from a `blob:` URL that `importScripts` jsQR off cdn.jsdelivr.net. Importing
 * it in the browser is therefore enough to trip the CSP in `netlify.toml`,
 * which allows neither `blob:` workers nor that CDN — on every page load, for a
 * scanner the web build never offers.
 *
 * `src/lib/camera.ts` + `camera.web.ts` exist to keep that import off web. The
 * regression is a one-word edit away — someone reaches for `CameraView` and
 * imports it from `expo-camera` out of habit — and it is invisible locally,
 * because a dev server sends no CSP. So it is asserted here.
 */

const SRC = path.resolve(__dirname, '..');

const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

/** Named exports of a module, from its `export` statements. */
const exportedNames = (source: string): string[] => {
  const names = new Set<string>();
  for (const m of source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  for (const m of source.matchAll(/export\s+(?:declare\s+)?(?:const|function|type|class)\s+(\w+)/g)) {
    names.add(m[1]);
  }
  return [...names].sort();
};

describe('the camera module is not imported on web', () => {
  it('is the only place expo-camera is imported', () => {
    // Anything else importing it directly re-opens the hole on web, since the
    // platform shim only helps the modules that go through it.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        const rel = path.relative(SRC, full);
        if (rel === 'lib/camera.ts' || rel === 'lib/camera.test.ts') continue;
        if (/from\s+'expo-camera'/.test(fs.readFileSync(full, 'utf8'))) offenders.push(rel);
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });

  it('has a web stub exporting everything the native module does', () => {
    // TypeScript only ever resolves camera.ts, so a missing export in the web
    // file is not a type error — it is an undefined at runtime, in the browser.
    expect(exportedNames(read('lib/camera.web.ts'))).toEqual(exportedNames(read('lib/camera.ts')));
  });

  it('keeps the CDN and the worker out of the web stub', () => {
    const web = read('lib/camera.web.ts');
    expect(web).not.toContain("from 'expo-camera'");
    expect(web).not.toContain('jsdelivr');
    expect(web).not.toContain('new Worker');
  });

  it('leaves the scanner screen importing through the shim', () => {
    const screen = read('screens/ScanJoinCodeScreen.tsx');
    expect(screen).toContain("from '../lib/camera'");
    expect(screen).not.toContain("from 'expo-camera'");
  });
});
