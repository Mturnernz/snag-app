import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Household, HouseholdMember, Location, Profile, Property } from '../types';
import {
  getDefaultPropertyId, getLocations, getMembers, getMyProperties,
} from '../lib/supabase';

/**
 * The household, the people in it, the places, and the tags for the place
 * currently selected.
 *
 * Loaded once rather than per screen because none of it changes often, and
 * because capture needs the property id before it can save anything. Waiting on
 * a round trip at the moment someone is holding a broken toilet seat is the one
 * place latency actually costs something.
 */
interface HouseholdContextValue {
  household: Household;
  profile: Profile;
  members: HouseholdMember[];
  /** Every place this person is linked to. One, until there's a bach. */
  properties: Property[];
  /** The place capture files against. Null only before the first load lands. */
  activeProperty: Property | null;
  /** Ignored when there is only one place to choose between. */
  setActiveProperty: (propertyId: string) => void;
  /** Tags for the active property, in seeded order. */
  locations: Location[];
  /**
   * Re-reads the active property's tags.
   *
   * Separate from `refresh` because the tag list is the one piece of this that
   * a screen can change: Profile → Location tags adds and removes them, and the
   * capture chips have to agree the moment someone comes back to them.
   */
  reloadLocations: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Re-reads the household itself from App.tsx — after adding a member. */
  reloadAccount: () => Promise<void>;
}

const HouseholdContext = createContext<HouseholdContextValue | null>(null);

export function HouseholdProvider({
  household,
  profile,
  onReload,
  children,
}: {
  household: Household;
  profile: Profile;
  onReload: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [activePropertyId, setActivePropertyId] = useState<string | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [nextMembers, nextProperties] = await Promise.all([
        getMembers(household.id),
        getMyProperties(),
      ]);
      setMembers(nextMembers);
      setProperties(nextProperties);

      // Keep the current selection if it survived; otherwise ask the server
      // which place this person last actually filed against.
      setActivePropertyId((current) =>
        current && nextProperties.some((p) => p.id === current) ? current : null
      );
      const fallback = await getDefaultPropertyId(nextProperties);
      setActivePropertyId((current) => current ?? fallback);
    } catch (err) {
      console.error('Failed to load household:', err);
    }
  }, [household.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Tags follow the selected place: a bach's are not a house's.
  const reloadLocations = useCallback(async () => {
    if (!activePropertyId) {
      setLocations([]);
      return;
    }
    try {
      setLocations(await getLocations(activePropertyId));
    } catch (err) {
      console.error('Failed to load location tags:', err);
    }
  }, [activePropertyId]);

  useEffect(() => {
    reloadLocations();
  }, [reloadLocations]);

  const activeProperty = useMemo(
    () => properties.find((p) => p.id === activePropertyId) ?? null,
    [properties, activePropertyId]
  );

  const value = useMemo(
    () => ({
      household,
      profile,
      members,
      properties,
      activeProperty,
      setActiveProperty: setActivePropertyId,
      locations,
      reloadLocations,
      refresh,
      reloadAccount: onReload,
    }),
    [
      household, profile, members, properties, activeProperty, locations,
      reloadLocations, refresh, onReload,
    ]
  );

  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
}

export function useHousehold(): HouseholdContextValue {
  const value = useContext(HouseholdContext);
  if (!value) throw new Error('useHousehold must be used inside a HouseholdProvider');
  return value;
}
