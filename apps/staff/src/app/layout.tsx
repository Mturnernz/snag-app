import type { Metadata } from 'next';
import { plexSans, plexMono } from '@/lib/fonts';
import './globals.css';

// The SnagHQ staff portal, on staff.snaghq.co.nz.
//
// Its own site rather than a path on www, because a cookie path is not a
// browser security boundary and a separate origin is: a staff session is
// reachable from nothing but these pages. See CLAUDE.md, *The staff portal*.
export const metadata: Metadata = {
  title: 'SnagHQ staff',
  applicationName: 'SnagHQ staff',
  // Never indexed. next.config.js also sends X-Robots-Tag on every response.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-NZ" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
