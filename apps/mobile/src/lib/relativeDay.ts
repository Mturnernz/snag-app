import { dayKey, formatDayFirst } from '@snag/supabase-queries';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * When something happened, the way one person says it to another: *Today*,
 * *Yesterday*, the weekday inside the last week, and the date, day first,
 * before that.
 *
 * It replaced `toLocaleDateString()` on notes (November 2026), which follows
 * the phone's locale: a phone set to US English wrote 11/14/2026 in an app
 * that is day-first everywhere else. A day is a local day (`dayKey`), so a
 * note written at 9pm in Auckland is today's, not tomorrow's.
 */
export function relativeDay(iso: string, now: Date = new Date()): string {
  const day = dayKey(iso);
  const [y, m, d] = day.split('-').map(Number);
  const [ty, tm, td] = dayKey(now).split('-').map(Number);
  // Midday on each, so a daylight-saving hour never tips the difference.
  const then = new Date(y, m - 1, d, 12);
  const today = new Date(ty, tm - 1, td, 12);
  const days = Math.round((today.getTime() - then.getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return WEEKDAYS[then.getDay()];
  return formatDayFirst(day);
}
