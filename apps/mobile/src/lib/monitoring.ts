/**
 * Error reporting, everywhere but the web build: nothing.
 *
 * `monitoring.web.ts` is the real one, and Metro picks it for the web export
 * because of its extension. This file is what native builds and jest resolve,
 * so neither carries the Sentry SDK. The web export is what people install,
 * and it is the only build monitored until a native one ships.
 */

export function initMonitoring(): void {}

export function reportError(_error: unknown, _context?: Record<string, string>): void {}
