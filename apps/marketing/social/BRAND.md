# Docunation / SNAG brand kit

One visual family across the app, website and social. Docunation is the
master brand; SNAG is the flagship product.

## Colours

| Token | Hex | Use |
|---|---|---|
| Brand blue 600 | `#2563EB` | SNAG primary — CTAs, links, product accent |
| Brand blue 500 | `#3B82F6` | Accent on dark backgrounds |
| Brand blue 100 | `#DBEAFE` | Tints, chips, icon backgrounds |
| Navy 950 | `#020617` | Docunation master dark, footers, dark social |
| Navy 900 | `#0F172A` | Dark surfaces, CTA bands |
| Serious red 600 | `#DC2626` | H&S / serious-lane content ONLY — never decorative |
| Ink | `#111827` | Primary text on light |
| Ink 2 | `#6B7280` | Secondary text |
| Canvas | `#F9FAFB` | Light page background |

Rules: blue is the default accent everywhere. Red is reserved for
hazard/incident/serious-lane meaning — if a design uses red decoratively,
it's wrong. Docunation-branded material leads with navy; SNAG-branded
material leads with blue.

## Type

Inter (variable), weights 500/600/700/800. Headlines: 800, tight tracking
(-0.02 to -0.03em). Body: 400–500. In the mobile app the system font stands
in for Inter — that's intentional.

## Wordmarks

- **SNAG**: camera glyph + "SNAG" in Inter 800. Glyph: blue rounded camera,
  white lens ring, blue pupil (see `public/favicon.svg`).
- **Docunation**: "Docu" in ink/navy (white on dark) + "nation" in brand blue.

## Voice

Plain-spoken, tradie-respectful, quietly confident. NZ/AU English
(organisation, smoko). Short sentences. Never scaremonger about compliance —
we make the paperwork painless, we don't threaten people with WorkSafe.
Catchphrase: **"Spot it. Snag it. Sorted."**

## Social sizes (templates in this folder)

| Template | Size | Platform |
|---|---|---|
| `og.html` | 1200×630 | Link previews everywhere (also the site's og.png) |
| `linkedin.html` | 1200×627 | LinkedIn feed/ads |
| `ig-square.html` | 1080×1080 | Instagram/Facebook feed |
| `ig-story.html` | 1080×1920 | Stories/Reels cover |

Regenerate PNGs with `npm run social` (outputs to `social/out/`).
