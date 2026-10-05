import { useCallback } from 'react';

import { useHousehold } from './useHousehold';
import { useToast } from './useToast';
import { createLocation } from '../lib/supabase';
import { showAlert } from '../lib/alert';

/**
 * Making a room from the picker a job's room is chosen in.
 *
 * Same write as the House tab's *Add a room*: `create_location` against the
 * place on screen, then `reloadLocations()`, so a room made here is a room
 * everywhere. Resolves false when the write was refused, having said why.
 */
export function useCreateRoom() {
  const { activeProperty, reloadLocations } = useHousehold();
  const { showToast } = useToast();

  return useCallback(async (name: string): Promise<boolean> => {
    if (!activeProperty) return false;
    try {
      await createLocation(activeProperty.id, name);
      await reloadLocations();
      showToast(`${name} added`);
      return true;
    } catch (err: any) {
      // The RPC refuses a blank name and a duplicate in words.
      showAlert("Couldn't add that room", err?.message ?? 'Please try again.');
      return false;
    }
  }, [activeProperty, reloadLocations, showToast]);
}
