/**
 * The slice of `expo-camera` this app uses, behind a module Metro resolves per
 * platform — `camera.web.ts` wins on web, this file everywhere else.
 *
 * Importing `expo-camera` directly from a screen is what this exists to stop.
 * Its web entry point builds a QR-decoding Web Worker **at module scope**:
 *
 *     const decode = createWorkerAsyncFunction(qrWorkerMethod, [
 *       'https://cdn.jsdelivr.net/npm/jsqr@1.2.0/dist/jsQR.min.js',
 *     ]);
 *
 * so merely importing it constructs `new Worker(URL.createObjectURL(blob))` and
 * reaches for a third-party CDN on every page load — whether or not anything
 * ever scans. `netlify.toml`'s CSP allows neither (`script-src` has no `blob:`
 * and no jsdelivr), so the production web build logged a refused-worker
 * violation on every load.
 *
 * Widening the CSP was the other way to end that, and it is the wrong one: it
 * would put a third-party CDN inside the trust boundary of a domain people are
 * asked to sign into, to enable a scanner the web build deliberately never
 * offers. `ScanJoinCodeScreen` forces manual code entry on web, so nothing here
 * is lost — see `camera.web.ts`.
 */
export { CameraView, useCameraPermissions } from 'expo-camera';
export type { BarcodeScanningResult } from 'expo-camera';
