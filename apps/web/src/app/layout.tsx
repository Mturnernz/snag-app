import type { Metadata } from 'next';
import { plexSans, plexMono } from '@/lib/fonts';
import { SITE_URL } from '@/lib/seo';
import './globals.css';

// www.snaghq.co.nz: the front page, the privacy statement, the terms, and
// password recovery.
//
// Password recovery is why this deploy exists at all. `@supabase/ssr` forces
// PKCE, and a PKCE recovery link only works in the browser that asked for it,
// which is never the browser someone opens their mail in. So the tokens
// arrive in the URL fragment, the landing page is a client component, and it
// cannot live inside the app.
//
// apps/mobile's sendPasswordReset points at `<this host>/reset-password`. If
// this deploy goes away, account recovery goes with it and nothing in the app
// will say so.
//
// Nothing is indexed unless a page asks to be. The front page, /privacy and
// /terms do. The account pages don't.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'Snag',
  description: 'The list of things that need doing around the house.',
  applicationName: 'Snag',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-NZ" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
