// Renders every social template to PNG at its exact platform size using the
// locally installed Chromium (Playwright). Run from apps/marketing:
//   npm run social
// Outputs land in social/out/ and the OG image is copied to public/og.png so
// the site's <meta og:image> always matches the current template.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, copyFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
mkdirSync(out, { recursive: true });

const TEMPLATES = [
  { file: 'og.html', width: 1200, height: 630 },
  { file: 'linkedin.html', width: 1200, height: 627 },
  { file: 'ig-square.html', width: 1080, height: 1080 },
  { file: 'ig-story.html', width: 1080, height: 1920 },
];

const executablePath = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';

const browser = await chromium.launch({ executablePath }).catch(() => chromium.launch());
for (const t of TEMPLATES) {
  const page = await browser.newPage({ viewport: { width: t.width, height: t.height } });
  await page.goto('file://' + join(here, t.file));
  await page.waitForTimeout(300); // let the variable font settle
  const png = join(out, t.file.replace('.html', '.png'));
  await page.screenshot({ path: png });
  console.log('rendered', png);
  await page.close();
}
await browser.close();

copyFileSync(join(out, 'og.png'), join(here, '..', 'public', 'og.png'));
console.log('copied og.png -> public/og.png');
