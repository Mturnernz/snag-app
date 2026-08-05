#!/usr/bin/env node
//
// Renders @snag/onboarding-guide into the two artifacts the apps can't produce
// for themselves: the markdown in the repo, and the printable PDFs the portal
// serves.
//
//   node scripts/build-onboarding-guide.mjs      (or: npm run guide)
//
// Run it whenever the guide's content changes — the whole point of the shared
// package is that the app screens, the markdown and the handouts can't say
// different things, and that only holds if the generated files are regenerated
// and committed alongside the source.
//
// No build step and no bundler dependency: Node strips the types out of the
// package's .ts on import (v22.18+). The package is one file for that reason —
// see its header comment.
//
// PDFs are printed with the Chromium that @playwright/test already installs for
// apps/web's e2e suite, so this adds no tooling. If it isn't there, the markdown
// is still written and the script says what to run.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GUIDE_SECTIONS,
  GUIDE_TITLE,
  GUIDE_VERSION,
  GUIDE_PDF_PATH,
  GUIDE_PDF_PATH_BY_ROLE,
  TOUR_ANCHORS,
  TOUR_STEPS,
  sectionsForRole,
  tourStepsForRole,
} from '../packages/onboarding-guide/src/index.ts';
import { ROLE_LABELS } from '../packages/shared-types/src/index.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'apps', 'web', 'public');
const FONT_DIR = path.join(ROOT, 'apps', 'web', 'src', 'fonts');
const MARKDOWN_OUT = path.join(ROOT, 'SNAG_ONBOARDING_GUIDE.md');

const BUILT = new Date().toISOString().slice(0, 10);

// ─── Markdown ────────────────────────────────────────────────────────────────

const escapeCell = (s) => String(s).replace(/\|/g, '\\|');

function markdownBlock(block) {
  switch (block.type) {
    case 'para':
      return block.text;
    case 'steps':
      return block.items.map((item, i) => `${i + 1}. ${item}`).join('\n');
    case 'bullets':
      return block.items.map((item) => `- ${item}`).join('\n');
    case 'callout':
      // Blockquote rather than a GitHub alert: this file is read in editors and
      // diffs as often as on github.com, and `> **Title**` degrades gracefully.
      return `> **${block.title}**\n>\n> ${block.text}`;
    case 'table': {
      const head = `| ${block.head.map(escapeCell).join(' | ')} |`;
      const rule = `| ${block.head.map(() => '---').join(' | ')} |`;
      const rows = block.rows.map((r) => `| ${r.map(escapeCell).join(' | ')} |`);
      return [head, rule, ...rows].join('\n');
    }
    default:
      throw new Error(`Unhandled block type: ${block.type}`);
  }
}

// ─── The walkthrough appendix ────────────────────────────────────────────────
//
// The app's guided walkthrough, written out step by step. It is generated from
// the same TOUR_STEPS the overlay runs, for the same reason the rest of this
// file exists: a trainer standing in a crib room with the printed handout and a
// crew member holding the phone should be looking at the same thing.

const ACTION_VERB = { tap: 'Tap', type: 'Type in', choose: 'Choose from', look: 'Look at' };

/** What a step points at, in words — for a page that has no spotlight. */
function stepTarget(step) {
  if (!step.anchor) return 'Anywhere — this one is about the app, not a control';
  // The anchor descriptions are written as noun phrases ("The Report tab") so
  // they read on their own; here they follow a verb, so the article drops case.
  return `${ACTION_VERB[step.action]} ${TOUR_ANCHORS[step.anchor].replace(/^The /, 'the ')}`;
}

function walkthroughMarkdown() {
  return [
    '<a id="the-walkthrough"></a>',
    '',
    '## Appendix — the in-app walkthrough',
    '',
    '*Every step the app walks a new starter through, in order.*',
    '',
    `**For:** ${Object.values(ROLE_LABELS).join(' · ')}`,
    '',
    'The first time somebody opens SNAG it dims the screen, puts a ring around one control at a time, and says what to do with it. It can be paused and picked up later, and replayed any time from Profile → Walkthrough. Each step is drawn from a section of this guide, so it is the same teaching in a shorter form — use this table to follow along, or to check what your crew have already been shown.',
    '',
    markdownBlock({
      type: 'table',
      head: ['Step', 'What it points at', 'For', 'From'],
      rows: TOUR_STEPS.map((step) => [
        step.title,
        stepTarget(step),
        step.roles.map((r) => ROLE_LABELS[r]).join(' · '),
        GUIDE_SECTIONS.find((s) => s.id === step.sectionId)?.title ?? step.sectionId,
      ]),
    }),
    '',
  ];
}

function toMarkdown(sections) {
  const out = [
    `# ${GUIDE_TITLE}`,
    '',
    `Version ${GUIDE_VERSION} · generated ${BUILT}`,
    '',
    '> Generated from `packages/onboarding-guide`. Don\'t edit this file by hand —',
    '> edit the package and run `npm run guide`, or the app and the handout stop',
    '> agreeing with each other.',
    '',
    '## Contents',
    '',
    ...sections.map((s, i) => `${i + 1}. [${s.title}](#${s.id})`),
    `${sections.length + 1}. [Appendix — the in-app walkthrough](#the-walkthrough)`,
    '',
  ];

  for (const section of sections) {
    const roles = section.roles.map((r) => ROLE_LABELS[r]).join(' · ');
    out.push(
      `<a id="${section.id}"></a>`,
      '',
      `## ${section.title}`,
      '',
      `*${section.summary}*`,
      '',
      `**For:** ${roles}`,
      '',
    );
    for (const block of section.blocks) {
      out.push(markdownBlock(block), '');
    }
  }

  out.push(...walkthroughMarkdown());

  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

// ─── HTML for print ──────────────────────────────────────────────────────────

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

async function fontFace(family, file, weight) {
  const buf = await readFile(path.join(FONT_DIR, file));
  return `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;font-display:block;src:url(data:font/woff2;base64,${buf.toString('base64')}) format('woff2');}`;
}

function htmlBlock(block) {
  switch (block.type) {
    case 'para':
      return `<p>${escapeHtml(block.text)}</p>`;
    case 'steps':
      return `<ol>${block.items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ol>`;
    case 'bullets':
      return `<ul>${block.items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
    case 'callout':
      return `<aside class="callout ${block.tone}"><p class="callout-title">${escapeHtml(block.title)}</p><p>${escapeHtml(block.text)}</p></aside>`;
    case 'table': {
      const head = block.head.some(Boolean)
        ? `<thead><tr>${block.head.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>`
        : '';
      const body = block.rows
        .map(
          (r) =>
            `<tr>${r
              .map((c, i) => `<td${i === 0 ? ' class="first"' : ''}>${escapeHtml(c)}</td>`)
              .join('')}</tr>`,
        )
        .join('');
      return `<table>${head}<tbody>${body}</tbody></table>`;
    }
    default:
      throw new Error(`Unhandled block type: ${block.type}`);
  }
}

/**
 * The walkthrough section of a PDF.
 *
 * Per role, and numbered, because the handout's job here is different from the
 * markdown's: a Site Lead training somebody wants to know what step 7 is, not
 * which roles see it.
 */
function walkthroughHtml(role, sectionNumber) {
  const steps = role ? tourStepsForRole(role) : TOUR_STEPS;
  const rows = steps
    .map(
      (step, i) =>
        `<tr><td class="first">${i + 1}. ${escapeHtml(step.title)}</td>` +
        `<td>${escapeHtml(stepTarget(step))}</td>` +
        `<td>${escapeHtml(step.body)}</td></tr>`,
    )
    .join('');

  return `
      <section>
        <p class="eyebrow">Section ${sectionNumber}</p>
        <h2>Appendix — the in-app walkthrough</h2>
        <p class="summary">The ${steps.length} steps the app walks ${
          role ? ROLE_LABELS[role] : 'a new starter'
        } through, in order.</p>
        <p>The first time somebody opens SNAG it dims the screen, rings one control at a time and says what to do with it. It can be paused and picked up later, and replayed any time from Profile &rarr; Walkthrough.</p>
        <table><thead><tr><th>Step</th><th>Points at</th><th>What it says</th></tr></thead><tbody>${rows}</tbody></table>
      </section>`;
}

async function toHtml(sections, { audience, role }) {
  const faces = (
    await Promise.all([
      fontFace('Plex', 'IBMPlexSans-Regular.woff2', 400),
      fontFace('Plex', 'IBMPlexSans-SemiBold.woff2', 600),
      fontFace('Plex', 'IBMPlexSans-Bold.woff2', 700),
    ])
  ).join('');

  const body = sections
    .map(
      (s, i) => `
      <section>
        <p class="eyebrow">Section ${i + 1}</p>
        <h2>${escapeHtml(s.title)}</h2>
        <p class="summary">${escapeHtml(s.summary)}</p>
        ${s.blocks.map(htmlBlock).join('\n')}
      </section>`,
    )
    .join('\n')
    .concat('\n', walkthroughHtml(role, sections.length + 1));

  // Light-only by design: this is printed. A dark theme would put a solid
  // #111827 across every page of a document destined for a crib-room wall.
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(GUIDE_TITLE)}</title>
<style>
${faces}
* { box-sizing: border-box; }
body { font-family: Plex, system-ui, sans-serif; color: #111827; margin: 0; font-size: 10.5pt; line-height: 1.55; }
.cover { background: #2563EB; color: #fff; padding: 26mm 18mm; margin-bottom: 12mm; }
.cover h1 { font-size: 30pt; font-weight: 700; margin: 0 0 4mm; letter-spacing: -0.5pt; }
.cover p { margin: 0; font-size: 12pt; opacity: 0.92; }
.cover .meta { margin-top: 10mm; font-size: 9pt; opacity: 0.8; }
main { padding: 0 18mm 18mm; }
section { page-break-inside: avoid; break-inside: avoid; margin-bottom: 9mm; }
.eyebrow { font-size: 7.5pt; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #6B7280; margin: 0 0 1mm; }
h2 { font-size: 15pt; font-weight: 700; margin: 0 0 1.5mm; color: #111827; }
.summary { color: #4B5563; font-size: 10pt; margin: 0 0 4mm; padding-bottom: 3mm; border-bottom: 1px solid #E5E7EB; }
p { margin: 0 0 3mm; color: #1F2937; }
ol, ul { margin: 0 0 3mm; padding-left: 6mm; color: #1F2937; }
li { margin-bottom: 1.5mm; }
ol li::marker { color: #2563EB; font-weight: 600; }
table { width: 100%; border-collapse: collapse; margin: 0 0 4mm; font-size: 9pt; }
th { text-align: left; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.04em; color: #6B7280; background: #F9FAFB; padding: 2mm 3mm; border-bottom: 1px solid #E5E7EB; }
td { padding: 2mm 3mm; border-bottom: 1px solid #E5E7EB; vertical-align: top; color: #1F2937; }
td.first { font-weight: 600; color: #111827; }
.callout { background: #DBEAFE; border-radius: 3mm; padding: 3.5mm 4mm; margin: 0 0 4mm; page-break-inside: avoid; }
.callout.warning { background: #FEE2E2; }
.callout-title { font-weight: 600; font-size: 9.5pt; margin: 0 0 1mm; color: #1D4ED8; }
.callout.warning .callout-title { color: #B91C1C; }
.callout p:last-child { margin: 0; font-size: 9.5pt; color: #374151; }
</style></head>
<body>
<div class="cover">
  <h1>${escapeHtml(GUIDE_TITLE)}</h1>
  <p>${escapeHtml(audience)}</p>
  <p class="meta">Version ${GUIDE_VERSION} · ${BUILT} · snaghq.co.nz</p>
</div>
<main>${body}</main>
</body></html>`;
}

// ─── PDF ─────────────────────────────────────────────────────────────────────

async function loadChromium() {
  try {
    const { chromium } = await import('playwright');
    return chromium;
  } catch {
    try {
      const { chromium } = await import('@playwright/test');
      return chromium;
    } catch {
      return null;
    }
  }
}

/**
 * Playwright refuses to launch a browser whose build number doesn't match the
 * version it ships with, which is right for a test suite pinning a rendering
 * engine and beside the point here — this prints a document. CI images and dev
 * containers routinely carry a Chromium a few builds off, so fall back to one
 * rather than failing the whole run over it. `CHROMIUM_PATH` wins if set.
 */
async function chromiumFallback() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!base) return null;
  const { readdir } = await import('node:fs/promises');
  let entries = [];
  try {
    entries = await readdir(base);
  } catch {
    return null;
  }
  // Newest build first — the directory names are `chromium-<build>`.
  const dirs = entries.filter((e) => /^chromium-\d+$/.test(e)).sort().reverse();
  for (const dir of dirs) {
    const exe = path.join(base, dir, 'chrome-linux', 'chrome');
    if (existsSync(exe)) return exe;
  }
  return null;
}

async function writePdfs(targets) {
  const chromium = await loadChromium();
  if (!chromium) {
    console.warn(
      '\n! Skipped the PDFs — Playwright isn\'t installed.\n' +
        '  Run `npm install` at the repo root, then re-run `npm run guide`.',
    );
    return false;
  }

  let browser;
  try {
    browser = await chromium.launch();
  } catch (err) {
    const executablePath = await chromiumFallback();
    if (!executablePath) {
      console.warn(
        `\n! Skipped the PDFs — no usable Chromium.\n  ${err.message.split('\n')[0]}\n` +
          '  Run `npx playwright install chromium`, or set CHROMIUM_PATH.\n' +
          '  The markdown above was still written.',
      );
      return false;
    }
    console.log(`  (using ${executablePath})`);
    browser = await chromium.launch({ executablePath });
  }

  try {
    const page = await browser.newPage();
    for (const { file, html, label } of targets) {
      await page.setContent(html, { waitUntil: 'load' });
      // The fonts are inlined as data: URIs, but `font-display: block` still
      // resolves asynchronously — printing before it settles silently falls
      // back to the default serif.
      await page.evaluate(() => document.fonts.ready);
      await page.pdf({
        path: path.join(PUBLIC_DIR, file),
        format: 'A4',
        printBackground: true,
        margin: { top: '0', bottom: '14mm', left: '0', right: '0' },
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate:
          '<div style="width:100%;font-family:sans-serif;font-size:7pt;color:#6B7280;padding:0 18mm;display:flex;justify-content:space-between;">' +
          `<span>SNAG — Getting started · v${GUIDE_VERSION}</span>` +
          '<span class="pageNumber"></span></div>',
      });
      console.log(`  ${file.padEnd(28)} ${label}`);
    }
  } finally {
    await browser.close();
  }
  return true;
}

// ─── Main ────────────────────────────────────────────────────────────────────

const ROLE_TARGETS = /** @type {const} */ ([
  ['worker', GUIDE_PDF_PATH_BY_ROLE.worker],
  ['supervisor', GUIDE_PDF_PATH_BY_ROLE.supervisor],
  ['officer_admin', GUIDE_PDF_PATH_BY_ROLE.officer_admin],
]);

async function main() {
  await writeFile(MARKDOWN_OUT, toMarkdown(GUIDE_SECTIONS), 'utf8');
  console.log(`\n  ${path.relative(ROOT, MARKDOWN_OUT)} (${GUIDE_SECTIONS.length} sections)\n`);

  if (!existsSync(PUBLIC_DIR)) await mkdir(PUBLIC_DIR, { recursive: true });

  const targets = [
    {
      file: path.basename(GUIDE_PDF_PATH),
      label: `every section (${GUIDE_SECTIONS.length}) + ${TOUR_STEPS.length} walkthrough steps`,
      html: await toHtml(GUIDE_SECTIONS, {
        audience: 'The complete guide — every role',
        role: null,
      }),
    },
  ];

  for (const [role, pdfPath] of ROLE_TARGETS) {
    const sections = sectionsForRole(role);
    targets.push({
      file: path.basename(pdfPath),
      label: `${ROLE_LABELS[role]} — ${sections.length} sections, ${tourStepsForRole(role).length} steps`,
      html: await toHtml(sections, { audience: `For ${ROLE_LABELS[role]}`, role }),
    });
  }

  const printed = await writePdfs(targets);
  if (printed) console.log('\n  Done. Commit the markdown and the PDFs together.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
