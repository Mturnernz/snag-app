import fs from 'fs';
import path from 'path';

/**
 * The web app manifest exists so an "Add to Home screen" shortcut gets a real
 * icon. Expo's export publishes one icon of its own — a favicon capped at 48px
 * by a hardcoded `[16, 32, 48]` in `@expo/cli` — so without the files under
 * `public/` the launcher upscales 48px to ~192px and the shortcut is blurry.
 *
 * That failure is invisible from inside the repo: the build still succeeds, the
 * app still loads, and the only place it shows up is on somebody's phone. So
 * the parts that would rot quietly are asserted here — the icons being present
 * at the sizes the manifest advertises, and the manifest agreeing with the
 * `web` block in app.json rather than drifting from it.
 */

const MOBILE_ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC_DIR = path.join(MOBILE_ROOT, 'public');

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** Width/height straight out of the PNG's IHDR chunk, so no image lib is needed. */
const pngSize = (file: string): { width: number; height: number } => {
  const header = Buffer.alloc(24);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, header, 0, 24, 0);
  } finally {
    fs.closeSync(fd);
  }
  expect(header.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
};

const manifest = readJson(path.join(PUBLIC_DIR, 'manifest.webmanifest'));
const appJson = readJson(path.join(MOBILE_ROOT, 'app.json'));
const indexHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

describe('web app manifest', () => {
  it('advertises an icon big enough for a launcher', () => {
    // A home-screen icon is ~192px on a modern Android density. Anything
    // smaller as the largest icon and the launcher is upscaling again.
    const largest = Math.max(
      ...manifest.icons.map((icon: { sizes: string }) => Number(icon.sizes.split('x')[0]))
    );
    expect(largest).toBeGreaterThanOrEqual(512);
  });

  it('points at icons that exist, at the size it claims', () => {
    expect(manifest.icons.length).toBeGreaterThan(0);

    for (const icon of manifest.icons as { src: string; sizes: string; type: string }[]) {
      expect(icon.src.startsWith('/')).toBe(true);
      const file = path.join(PUBLIC_DIR, icon.src.replace(/^\//, ''));
      expect(fs.existsSync(file)).toBe(true);

      const [width, height] = icon.sizes.split('x').map(Number);
      expect(pngSize(file)).toEqual({ width, height });
      expect(icon.type).toBe('image/png');
    }
  });

  it('offers a maskable icon, so Android does not letterbox it', () => {
    // assets/icon.png is full-bleed with the mark inside the safe zone, so the
    // same file serves both purposes — but the purpose has to be declared or
    // Android pads the icon into a smaller square inside the squircle.
    const maskable = (manifest.icons as { purpose?: string }[]).filter((icon) =>
      (icon.purpose ?? 'any').split(/\s+/).includes('maskable')
    );
    expect(maskable.length).toBeGreaterThan(0);
  });

  it('agrees with the web block in app.json', () => {
    const web = appJson.expo.web;
    expect(manifest.name).toBe(web.name);
    expect(manifest.short_name).toBe(web.shortName);
    expect(manifest.description).toBe(web.description);
    expect(manifest.theme_color).toBe(web.themeColor);
    expect(manifest.background_color).toBe(web.backgroundColor);
  });

  it('starts at the root, which is the tab the navigator falls back to', () => {
    // "/" is deliberately unmapped in linking.ts, so it lands on the tab
    // navigator's initialRouteName rather than a matched route. See CLAUDE.md.
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
  });
});

describe('web HTML shell', () => {
  it('links the manifest and an apple-touch-icon', () => {
    // Expo injects neither. iOS ignores the manifest entirely and reads
    // apple-touch-icon, so dropping either one costs a platform its icon.
    expect(indexHtml).toContain('rel="manifest"');
    expect(indexHtml).toContain('href="/manifest.webmanifest"');
    expect(indexHtml).toContain('rel="apple-touch-icon"');

    const appleIcon = indexHtml.match(/rel="apple-touch-icon"[^>]*href="([^"]+)"/);
    expect(appleIcon).not.toBeNull();
    const file = path.join(PUBLIC_DIR, appleIcon![1].replace(/^\//, ''));
    expect(fs.existsSync(file)).toBe(true);
    expect(pngSize(file)).toEqual({ width: 180, height: 180 });
  });

  it('keeps the placeholders the Expo template pipeline substitutes', () => {
    // createTemplateHtmlAsync replaces these by string match. Lose one and the
    // export still succeeds, having shipped the literal token to production.
    expect(indexHtml).toContain('id="expo-reset"');
    expect(indexHtml).toContain('id="root"');

    // Exactly once each, and this is not a style preference. Expo substitutes
    // them with String.replace, which replaces only the first occurrence — so a
    // second mention anywhere (a comment above the tag, say) silently swallows
    // the substitution and the real tag ships the literal token. A `lang` of
    // "%LANG_ISO_CODE%" and a browser tab reading "%WEB_TITLE%" is what that
    // looks like in production, and the export still exits 0.
    const occurrences = (token: string) => indexHtml.split(token).length - 1;
    expect(occurrences('%LANG_ISO_CODE%')).toBe(1);
    expect(occurrences('%WEB_TITLE%')).toBe(1);

    expect(indexHtml).toContain('<html lang="%LANG_ISO_CODE%">');
    expect(indexHtml).toContain('<title>%WEB_TITLE%</title>');
  });

  it('does not duplicate the meta tags Expo injects from app.json', () => {
    expect(indexHtml).not.toContain('name="theme-color"');
    expect(indexHtml).not.toContain('name="description"');
  });
});
