/**
 * Web stand-in for `camera.ts`, resolved by Metro's platform extensions so that
 * `expo-camera` is never imported in the browser. See `camera.ts` for why that
 * matters — in short, importing it spawns a `blob:` Web Worker that pulls jsQR
 * off a CDN at module scope, and the app's CSP refuses both.
 *
 * Nothing here is a degraded version of a feature: `ScanJoinCodeScreen` sets
 * `isManualOnly` on web and its only `setManualEntry(false)` is guarded by it,
 * so the camera branches are unreachable on this platform. These exports exist
 * to satisfy the import, not to be rendered or called.
 *
 * Types deliberately come from `camera.ts` (TypeScript resolves that, not this
 * file), so the screen still typechecks against the real `expo-camera` types.
 * `camera.test.ts` asserts the two files keep the same exports.
 */
import type { ComponentType, ReactNode } from 'react';

export type BarcodeScanningResult = { data: string };

/** Never rendered on web — the scanner branch is unreachable here. */
export const CameraView: ComponentType<{ children?: ReactNode }> = () => null;

/**
 * Mirrors `expo-camera`'s tuple. `null` is its "not determined yet" value, and
 * the screen already renders a blank view for it, so even an unreachable render
 * degrades to nothing rather than throwing.
 */
export function useCameraPermissions(): [null, () => Promise<void>] {
  return [null, async () => {}];
}
