import { describeCycle, thingHeadline } from '@snag/supabase-queries';
import { createSnag } from './supabase';
import { Thing } from '../types';

/**
 * A service cycle answered in the walkthrough, put on the list.
 *
 * The walkthrough's last step asked *Serviced how often?*, stored the answer on
 * the thing, and put nothing on the list — so the heat pump somebody had just
 * said is serviced every year was never serviced, because the list is the only
 * place this app tells anybody anything. It is the same job the thing page's
 * *Schedule service* files: about this thing, in its room, **created already
 * dated and repeating** in one call, so it goes on the list as open rather than
 * as a job somebody has started. The first one lands a whole cycle out.
 *
 * Returns the words for the toast. The thing is saved either way; a job that
 * could not be filed is said, never thrown, because failing it would read as
 * the record not having saved.
 */
export async function fileServiceJob(thing: Thing): Promise<string | null> {
  if (!thing?.serviceDays) return null;
  const due = new Date();
  due.setHours(0, 0, 0, 0);
  due.setDate(due.getDate() + thing.serviceDays);
  const servicedBy = thing.spec?.servicedBy;
  try {
    await createSnag({
      propertyId: thing.propertyId,
      room: thing.room,
      description: `Service the ${thingHeadline(thing).toLowerCase()}${servicedBy ? ` · ${servicedBy}` : ''}`,
      thingId: thing.id,
      dueAt: due.toISOString(),
      repeatDays: thing.serviceDays,
    });
    return `Service on the list · every ${describeCycle(thing.serviceDays)}`;
  } catch {
    return "In the record — the service job couldn't be added, try Schedule service on its page";
  }
}
