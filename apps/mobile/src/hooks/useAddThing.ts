import { useCallback, useState } from 'react';

import type { ThingInput } from '@snag/supabase-queries';
import { useHousehold } from './useHousehold';
import { useToast } from './useToast';
import { createLocation, createThing } from '../lib/supabase';
import { showAlert } from '../lib/alert';
import { fileServiceJob } from '../lib/serviceJob';
import type { ThingKind } from '../types';

/** Where the walkthrough opens: a room already chosen, or a ghost already named. */
export type AddThingStart = { room?: string | null; name?: string | null; kind?: ThingKind } | null;

/**
 * Recording a thing, from whichever screen the + was pressed on.
 *
 * The House tab's grid and a room's own page both open the same four-step
 * walkthrough, and both have to write the same way: `create_thing`, then the
 * service job its cycle asks for, then one toast. Two copies of that is two
 * places for "added to the house" to mean different things.
 *
 * `onAdded` re-reads whatever the calling screen shows. The sheet stays open on
 * a failure: everything typed is still in it, and the retry is the same button.
 */
export function useAddThing(onAdded: () => void | Promise<void>) {
  const { household, activeProperty, locations, reloadLocations } = useHousehold();
  const { showToast } = useToast();
  const [visible, setVisible] = useState(false);
  const [start, setStart] = useState<AddThingStart>(null);

  const open = useCallback((next: AddThingStart = null) => {
    setStart(next);
    setVisible(true);
  }, []);

  /**
   * A room added from here is a room everywhere. It writes to
   * `home.locations`, which is the same list the List tab groups by and capture
   * offers — rooms are a property's vocabulary, not one tab's.
   */
  async function addRoom(name: string): Promise<boolean> {
    if (!activeProperty) return false;
    try {
      await createLocation(activeProperty.id, name);
      await reloadLocations();
      showToast(`${name} added`);
      return true;
    } catch (err: any) {
      // The RPC refuses a blank name and a duplicate in words, so this is worth
      // showing rather than swallowing.
      showAlert("Couldn't add that room", err?.message ?? 'Please try again.');
      return false;
    }
  }

  async function add(input: Omit<ThingInput, 'propertyId'>) {
    if (!activeProperty) {
      showAlert('No place yet', 'Add a place before adding to the house record.');
      return;
    }
    try {
      const created = await createThing({ ...input, propertyId: activeProperty.id });
      setVisible(false);
      showToast((await fileServiceJob(created)) ?? 'Added to the house');
      await onAdded();
    } catch (err: any) {
      showAlert("Couldn't add that", err?.message ?? 'Please try again.');
    }
  }

  return {
    open,
    addRoom,
    /** Spread onto `<AddThingSheet>`. */
    sheet: {
      visible,
      locations,
      pathPrefix: household.id,
      start,
      onAddRoom: addRoom,
      onCancel: () => setVisible(false),
      onAdd: add,
    },
  };
}
