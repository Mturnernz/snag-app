/** @type {import('next').NextConfig} */

// Security headers. Neither host sent any before this — no framing protection
// on a portal that renders incident data, no MIME-sniffing protection, and a
// full Referer to wherever a document link pointed.
//
// `frame-ancestors 'none'` is the load-bearing one: the portal has irreversible
// controls (resolve, waive, delete evidence) behind ordinary buttons, and
// clickjacking is the attack that turns those into one click on a page the
// user thinks is something else. X-Frame-Options is the same rule for anything
// predating CSP.
//
// script-src deliberately still allows inline and eval. Next.js App Router
// inlines its bootstrap and flight payloads, so locking scripts down means
// generating a per-request nonce in middleware and threading it through — a
// real change that needs testing against a deployed build, not a config line.
// The rest of the policy is set now because it costs nothing and breaks
// nothing: an injected <base>, a form re-pointed at another origin, and a
// plugin/object embed are all closed regardless.
//
// Supabase is wildcarded rather than pinned to the project ref so this keeps
// working if the project moves; both the REST/auth origin and the realtime
// websocket have to be reachable.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  // Supabase belongs here for the same reason it's in connect-src, and leaving
  // it out broke both exports on /reports in a way that looked like a slow
  // server rather than a policy.
  //
  // Both export routes are reached by <form method="post"> and finish with a
  // 303 to a signed storage URL. `form-action` is checked against every
  // redirect hop after a form submission, not just the initial target, so the
  // browser did all the waiting — query, upload, audit row, signing — and then
  // refused the last step. The file was written and recorded every time; only
  // the person who asked for it never saw it.
  "form-action 'self' https://*.supabase.co",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CSP },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Two years, with preload eligibility. www.snaghq.co.nz is HTTPS-only via
  // Netlify already; this stops the first plaintext request on a new device.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // The portal asks for none of these. The mobile app is where the camera is.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
];

const nextConfig = {
  // packages/* are TS source with no build step — Next needs to compile them
  // itself rather than treating them as pre-built external node_modules.
  transpilePackages: ['@snag/shared-types', '@snag/supabase-queries'],

  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

module.exports = nextConfig;
