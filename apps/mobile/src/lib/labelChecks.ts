import { getLabelReadingsToCheck } from './supabase';

/**
 * The things at this place with a label reading waiting on their page — one
 * that landed after *Add it*, or never landed.
 *
 * Shared by the House tab's grid (the *N labels to check* pill) and a room's
 * page (the marker on each row), so the two cannot disagree about what is
 * waiting. A reading still being read is not something to check yet, so it is
 * left out. **Never throws**: a count nobody can fetch is a count of nought,
 * which is also what it usually is, and the record must still draw.
 */
export async function labelsToCheck(propertyId: string): Promise<string[]> {
  try {
    const waiting = await getLabelReadingsToCheck(propertyId);
    return waiting.filter((one) => one.status !== 'pending').map((one) => one.thingId);
  } catch {
    return [];
  }
}
