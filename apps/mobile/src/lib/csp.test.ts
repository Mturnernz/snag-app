import { readFileSync } from 'fs';
import { join } from 'path';

// The deployed CSP is part of whether this app works, not just whether it is
// safe — and it is the one part of the app no test, no typecheck and no local
// `expo start` ever sees, because the header only exists on Netlify. Getting it
// wrong takes down a whole feature in production while everything here stays
// green, which is exactly what happened: connect-src shipped without blob:, so
// `readForUpload` could not read a single picked file, and every upload on the
// web build failed for a day saying "no connection".
//
// So this pins the schemes the app's own code depends on. It cannot check the
// deployed header — only that the file we deploy still says what the code
// needs.

const CSP = (() => {
  const toml = readFileSync(join(__dirname, '..', '..', 'netlify.toml'), 'utf8');
  const match = toml.match(/Content-Security-Policy\s*=\s*"([^"]+)"/);
  if (!match) throw new Error('No Content-Security-Policy in apps/mobile/netlify.toml');
  return match[1];
})();

const directive = (name: string): string[] => {
  const found = CSP.split(';')
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  if (!found) throw new Error(`No ${name} in the deployed CSP`);
  return found.split(/\s+/).slice(1);
};

describe('the web build’s deployed CSP', () => {
  // Two different needs, and satisfying one says nothing about the other:
  // img-src renders the thumbnail, connect-src reads the bytes. img-src alone
  // is the state that broke uploads while leaving the picker looking perfect.
  it('allows blob: where the picker previews a photo', () => {
    expect(directive('img-src')).toContain('blob:');
  });

  it('allows blob: where readForUpload fetches that photo back', () => {
    // Chrome does not let 'self' cover blob:, whatever the blob's origin.
    expect(directive('connect-src')).toContain('blob:');
  });

  it('allows the Supabase origin the client talks to, over both protocols', () => {
    expect(directive('connect-src')).toEqual(
      expect.arrayContaining(['https://*.supabase.co', 'wss://*.supabase.co']),
    );
  });

  // Not a load-bearing upload path, but the reason the header exists at all —
  // a framed copy of the app is how a QR-code landing page becomes a phishing
  // shell, and it would be quietly lost in an edit to the line above.
  it('still refuses to be framed', () => {
    expect(directive('frame-ancestors')).toEqual(["'none'"]);
  });
});

// An extract is handed over as a Blob, an object URL and an anchor carrying
// `download`. Verified against this exact policy in Chromium: the download
// fires and no violation is logged. What would silently kill it is `sandbox`,
// which blocks downloads unless it names allow-downloads — and a sandbox
// directive is the sort of thing added to a policy for unrelated reasons.
//
// Nothing else in the policy governs it: a download is a navigation, not a
// fetch, so connect-src does not apply, and object-src covers <object>/<embed>
// rather than <a download>.
describe('the directives an extract download depends on', () => {
  it('never sandboxes the page, which would block downloads outright', () => {
    expect(CSP).not.toMatch(/\bsandbox\b/);
  });

  // Both renderers are bundled because they have to be: no CDN is reachable
  // under default-src 'self', and "output": "single" leaves no lazy chunk to
  // fetch either. If this ever loosens, that reasoning is stale.
  it('still allows no third-party origin to be fetched at export time', () => {
    expect(directive('default-src')).toEqual(["'self'"]);
  });
});

// Not the CSP, but the same class of failure: something the deployed site does
// that nothing local enforces, and whose absence is silent until somebody in a
// kitchen points a camera at a code.
describe('the SPA rewrite a join code depends on', () => {
  const TOML = readFileSync(join(__dirname, '..', '..', 'netlify.toml'), 'utf8');

  // `/join/<token>` is a path, not a query string, and the export publishes one
  // index.html and no /join directory. Without a catch-all rewrite Netlify
  // answers 404 before the app loads at all — so the QR would be dead on
  // arrival with everything here green and nothing in the app able to say why.
  it('serves index.html for a path the export never wrote a file for', () => {
    const redirect = TOML.match(/\[\[redirects\]\][\s\S]*?from\s*=\s*"([^"]+)"[\s\S]*?to\s*=\s*"([^"]+)"[\s\S]*?status\s*=\s*(\d+)/);
    expect(redirect).not.toBeNull();
    expect(redirect![1]).toBe('/*');
    expect(redirect![2]).toBe('/index.html');
    expect(redirect![3]).toBe('200');
  });

  // A QR landing page inside an iframe is the classic phishing shell: the code
  // looks like it came from Snag and the page around it is somebody else's.
  it('refuses to be framed, which is what a join landing page invites', () => {
    expect(directive('frame-ancestors')).toEqual(["'none'"]);
  });
});
