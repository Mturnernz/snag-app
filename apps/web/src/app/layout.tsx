import type { Metadata } from 'next';
import { plexSans, plexMono } from '@/lib/fonts';
import { SITE_URL } from '@/lib/seo';
import './globals.css';

// SnagHQ is this app — the marketing site and the supervisor portal. Snag is
// the mobile app, and stays "Snag"/"SNAG" wherever the copy means the phone.
// The distinction lives in metadata only; the rendered wordmark is unchanged.
//
// metadataBase is what every relative canonical and OpenGraph URL on a child
// page is resolved against. Without it Next emits localhost URLs into social
// cards and warns at build. See @/lib/seo for why the origin is a constant.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'SnagHQ — workplace health & safety reporting',
    template: '%s | SnagHQ',
  },
  description:
    'Report hazards from your phone. Investigate, verify, and close them with a record that holds up. Built for New Zealand HSWA 2015.',
  applicationName: 'SnagHQ',
  // No `url` here on purpose: a default og:url is inherited verbatim by every
  // child, so each page would claim to be the homepage. Pages set their own
  // via canonical() in @/lib/seo.
  openGraph: {
    siteName: 'SnagHQ',
    type: 'website',
    locale: 'en_NZ',
  },
  twitter: {
    card: 'summary_large_image',
  },
  // No opengraph-image yet. A share graphic is design work, not an SEO fix,
  // and a metadata entry pointing at a file that doesn't exist ships a 404 on
  // every page — which e2e/public.spec.ts would (correctly) fail on.
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-NZ" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
