import localFont from 'next/font/local';

// Self-hosted IBM Plex, the same pair the staff portal uses rather than one
// picked twice. next/font/local subsets and self-hosts these with zero layout
// shift and no external request.
export const plexSans = localFont({
  src: [
    { path: '../fonts/IBMPlexSans-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/IBMPlexSans-SemiBold.woff2', weight: '600', style: 'normal' },
    { path: '../fonts/IBMPlexSans-Bold.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-sans',
  display: 'swap',
});

export const plexMono = localFont({
  src: [
    { path: '../fonts/IBMPlexMono-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/IBMPlexMono-Medium.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-mono',
  display: 'swap',
});
