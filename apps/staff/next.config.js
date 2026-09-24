/** @type {import('next').NextConfig} */

// The staff portal's headers. The same policy as apps/web — see the comments
// there for why each directive is what it is — with one addition: nothing on
// this host may ever be indexed, so X-Robots-Tag rides on every response
// rather than relying on a meta tag a redirect or an error page might not
// carry.
//
// Signed photograph URLs are on *.supabase.co, which img-src already allows.
// The Google sign-in is a navigation (supabase-js sets window.location), not a
// fetch or a form post, so neither connect-src nor form-action governs it.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://*.supabase.co",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CSP },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];

const nextConfig = {
  // packages/* are TS source with no build step — Next compiles them itself.
  transpilePackages: ['@snag/shared-types', '@snag/supabase-queries'],

  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

module.exports = nextConfig;
