# Investigation file — layout notes

The PDF is a regulator-facing document, so it is laid out like a record rather
than a console dump. Design follows `apps/mobile/src/constants/theme.ts` so the
artefact and the app read as the same product.

| Element | Token | Value |
|---|---|---|
| Brand band, section headings | `Colors.primary` | `#2563EB` |
| Body text | `Colors.textPrimary` | `#111827` |
| Labels, footer | `Colors.textMuted` | `#6B7280` |
| Values, secondary copy | `Colors.textSecondary` | `#4B5563` |
| Hairlines | `Colors.border` | `#E5E7EB` |
| Notifiable callout | `Colors.serious` / `seriousBg` | `#DC2626` / `#FEE2E2` |

Structure:

1. **Masthead** (page 1 only) — brand band carrying the SNAG wordmark, the
   document type, and the snag reference right-aligned.
2. **Running header** (page 2+) — hairline plus reference, so a loose page is
   still identifiable. That matters for a document that gets printed.
3. **Summary grid** — the facts a reader checks first, as label/value pairs
   rather than prose.
4. **Notifiable callout** — only when the flag is set. It is the one thing on
   the page that gets the serious-lane red.
5. **Sections** — uppercase heading, hairline, content.
6. **Photographs** — the snag's own photos, which the file never used to
   include, then evidence images under their captions.
7. **Footer** on every page — reference, page N of M, generated timestamp.

Fonts are the PDF standard Helvetica. IBM Plex (the web app's face) would need
the font file embedded via fontkit; not worth the payload for this, and
Helvetica keeps the file small and universally renderable.
