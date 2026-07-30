// Renders each template's HTML source to a PDF for upload to the document
// library. Chromium rather than LibreOffice: the container's LibreOffice is
// core-only (no Writer module), so it cannot load any input format at all —
// and Chromium is already here for the E2E suite, honours the print CSS in
// each template, and is what the PDFs were designed against.
//
//   node docs/templates/render.mjs
//
// The HTML files are the editable masters. Regenerate the PDFs after any edit;
// don't hand-patch a PDF.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = ['notifiable-event-procedure', 'hsr-election-procedure'];

// Same escape hatch playwright.config.ts uses: a sandbox may ship a Chromium
// that doesn't match the build this playwright version would fetch, and
// `playwright install` is not available there.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage();

for (const name of TEMPLATES) {
  await page.goto(`file://${join(here, `${name}.html`)}`, { waitUntil: 'load' });
  await page.pdf({
    path: join(here, `${name}.pdf`),
    format: 'A4',
    printBackground: true,
    margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' },
  });
  console.log(`rendered ${name}.pdf`);
}

await browser.close();
