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
