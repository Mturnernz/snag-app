import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SNAG',
  description: 'Workplace issue reporting and safety investigation.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
