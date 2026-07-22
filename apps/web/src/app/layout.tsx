import type { Metadata } from 'next';
import { plexSans, plexMono } from '@/lib/fonts';
import './globals.css';

export const metadata: Metadata = {
  title: 'SNAG',
  description: 'Workplace issue reporting and safety investigation.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
