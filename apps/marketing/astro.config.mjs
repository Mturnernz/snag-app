// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// Placeholder until the real domain is registered — override at build time
// with SITE_URL=https://yourdomain npm run build. Every canonical/OG/sitemap
// URL derives from this one value.
const SITE_URL = process.env.SITE_URL ?? 'https://snag-placeholder.netlify.app';

export default defineConfig({
  site: SITE_URL,
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
});
