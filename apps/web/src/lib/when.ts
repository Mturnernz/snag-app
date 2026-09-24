/**
 * Dates the way the portal shows them. Always in New Zealand time, stated
 * rather than left to the server: Netlify's functions run in UTC, and a
 * question asked at 9pm in Auckland would otherwise read as the next morning.
 */
const TZ = 'Pacific/Auckland';

export function dayTime(iso: string): string {
  return new Date(iso).toLocaleString('en-NZ', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NZ', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
}
