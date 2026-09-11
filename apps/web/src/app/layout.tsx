import type { Metadata } from 'next';
import { plexSans, plexMono } from '@/lib/fonts';
import { SITE_URL } from '@/lib/seo';
import './globals.css';

// What remains of the web app.
//
// The marketing site and the supervisor portal went with the B2B product. This
// deploy exists for one reason: password recovery has to land on a plain web
// page. `@supabase/ssr` forces PKCE, and a PKCE recovery link only works in
// the browser that asked for it — which is never the browser someone opens
// their mail in. So the tokens arrive in the URL fragment, the landing page is
// a client component, and it cannot live inside the app.
//
// apps/mobile's sendPasswordReset points at `<this host>/reset-password`. If
// this deploy goes away, account recovery goes with it and nothing in the app
// will say so.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'Snag',
  description: 'Reset your Snag password.',
  applicationName: 'Snag',
  // Nothing here should be indexed — it is two account pages, not a site.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-NZ" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
