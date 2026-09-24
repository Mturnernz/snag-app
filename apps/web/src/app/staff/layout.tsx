import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'SnagHQ staff',
  robots: { index: false, follow: false },
};

export default function StaffRoot({ children }: { children: React.ReactNode }) {
  return children;
}
