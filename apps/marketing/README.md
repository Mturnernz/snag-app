# SNAG marketing site

Static marketing site for SNAG (and the Docunation one-pager), built with
Astro + Tailwind. Lives on the `website` branch — the mobile app's branches
never touch it and vice-versa.

## Develop

```bash
cd apps/marketing
npm install
npm run dev        # http://localhost:4321
npm run build      # static output in dist/
npm run social     # render social/og image PNGs (needs local Chromium)
```

## Deploy (one-time setup)

1. In Netlify, create a **new site** from this GitHub repo with:
   - **Production branch:** `website`
   - **Base directory:** `apps/marketing`
   (Build command/publish dir come from `netlify.toml`.)
2. Register the real domain (e.g. `getsnag.co.nz`) and add it to the site.
3. Set the env var `SITE_URL=https://yourdomain` in Netlify → every
   canonical URL, OG tag and the sitemap update automatically.
4. Netlify Forms picks up the contact form automatically — turn on email
   notifications for the `early-access` form in the dashboard.

## Before going live checklist

- [ ] Real domain + `SITE_URL` set
- [ ] `src/config.ts`: real contact email
- [ ] Privacy policy & terms reviewed (currently drafts)
- [ ] `npm run social` re-run so `public/og.png` is current
- [ ] Analytics: set `plausibleDomain` in `src/config.ts` when ready
- [ ] Pixels: Meta/LinkedIn IDs in `src/config.ts` once ad accounts exist

## Structure

- `src/pages/` — home, features, pricing, contact, privacy, terms, blog,
  `/docunation` one-pager
- `src/components/` — header/footer/wordmarks/cards/phone mockup
- `src/styles/global.css` — design tokens (mirrors the app's theme.ts)
- `social/` — brand kit + social image templates (`BRAND.md`)
