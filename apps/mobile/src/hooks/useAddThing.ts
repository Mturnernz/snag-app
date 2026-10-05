import { useCallback, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { WHOLE_HOUSE, type ThingInput } from '@snag/supabase-queries';
import { useHousehold } from './useHousehold';
import { useToast } from './useToast';
import { createLocation, createThing, setThingUses } from '../lib/supabase';
import { showAlert } from '../lib/alert';
import { fileServiceJob } from '../lib/serviceJob';
import type { RootStackParamList, ThingKind } from '../types';

/** Where the walkthrough opens: a room already chosen, or a ghost already named. */
export type AddThingStart = { room?: string | null; name?: string | null; kind?: ThingKind } | null;

/**
 * Recording a thing, from whichever screen the + was pressed on.
 *
 * The House tab's grid and a room's own page both open the same
 * walkthrough, and both have to write the same way: `create_thing`, then the
 * service job its cycle asks for, then one toast. Two copies of that is two
 * places for "added to the house" to mean different things.
 *
 * `onAdded` re-reads whatever the calling screen shows. The sheet stays open on
 * a failure: everything typed is still in it, and the retry is the same button.
 *
 * **It says where the thing went, with a way there.** `showingRoom` is the room
 * whose page is on screen (null for Whole house), or undefined on the grid. A
 * weed killer recorded in the Garage from the grid used to say only *Added to
 * the house* — and the Garage, holding one thing, was the ninth tile of
 * thirteen, below the fold, so it read as lost and was recorded again. Now the
 * toast names the room and offers *Open*, unless that room is the page already
 * showing it.
 */
export function useAddThing(onAdded: () => void | Promise<void>, showingRoom?: string | null) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
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

  /** Resolves false when the write was refused, so the sheet knows it is still open for a reason. */
  async function add(input: Omit<ThingInput, 'propertyId'>): Promise<boolean> {
    if (!activeProperty) {
      showAlert('No place yet', 'Add a place before adding to the house record.');
      return false;
    }
    try {
      const { usedWith, ...fields } = input;
      const created = await createThing({ ...fields, propertyId: activeProperty.id });
      setVisible(false);
      const room = created.room ?? null;
      // What a consumable goes with is a second write. The thing exists either
      // way, so a refusal is said rather than thrown — and said as what it is.
      let unlinked = false;
      if (usedWith?.length) {
        try {
          await setThingUses(created.id, usedWith);
        } catch {
          unlinked = true;
        }
      }
      // A service job filed with it is the bigger news, so its words win; the
      // way to the room is offered either way.
      const said = unlinked
        ? `Added to ${room ?? WHOLE_HOUSE} — couldn't link what it's used with`
        : (await fileServiceJob(created)) ?? `Added to ${room ?? WHOLE_HOUSE}`;
      showToast(
        said,
        room === showingRoom
          ? undefined
          : { label: 'Open', onPress: () => navigation.navigate('HouseRoom', { room }) },
      );
      await onAdded();
      return true;
    } catch (err: any) {
      showAlert("Couldn't add that", err?.message ?? 'Please try again.');
      return false;
    }
  }

  /**
   * A reading that landed after *Add it* is waiting on the thing's page. Said
   * once while the app is open, and the screen re-read so its *Label to check*
   * marker appears. Still no notifications: nothing is said once it is closed.
   */
  function lateReading(name: string, readable: boolean) {
    showToast(readable ? `Read the label for ${name} — check it` : `Couldn't read the label for ${name}`);
    onAdded();
  }

  /**
   * The walkthrough's *Open that one*: somebody about to record a second weed
   * killer in the Garage would rather see the first. Nothing is written.
   */
  function openThing(thingId: string) {
    setVisible(false);
    navigation.navigate('ThingDetail', { thingId });
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
      onLateReading: lateReading,
      onOpenThing: openThing,
    },
  };
}
