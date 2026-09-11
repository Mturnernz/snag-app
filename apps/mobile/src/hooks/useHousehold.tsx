import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Household, HouseholdMember, Location, Profile, Property } from '../types';
import { getDefaultProperty, getMembers, getLocations } from '../lib/supabase';

/**
 * The household, the people in it, the property every snag hangs off, and the
 * location tags offered at capture.
 *
 * These are loaded once rather than per screen because they change roughly
 * never — a two-person household adds a member once and then not again — and
 * because the capture screen needs the property id before it can save
 * anything. Waiting on a round trip at the moment someone is holding a broken
 * toilet seat is the one place latency actually costs something.
 */
interface HouseholdContextValue {
  household: Household;
  profile: Profile;
  members: HouseholdMember[];
  /** Null only in the moment before the first load finishes. */
  property: Property | null;
  /** The location tags, in seeded order. */
  locations: Location[];
  /** Re-reads members, property and locations. */
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
  const [property, setProperty] = useState<Property | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [nextMembers, nextProperty, nextLocations] = await Promise.all([
        getMembers(household.id),
        getDefaultProperty(household.id),
        getLocations(household.id),
      ]);
      setMembers(nextMembers);
      setProperty(nextProperty);
      setLocations(nextLocations);
    } catch (err) {
      console.error('Failed to load household:', err);
    }
  }, [household.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ household, profile, members, property, locations, refresh, reloadAccount: onReload }),
    [household, profile, members, property, locations, refresh, onReload]
  );

  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
}

export function useHousehold(): HouseholdContextValue {
  const value = useContext(HouseholdContext);
  if (!value) throw new Error('useHousehold must be used inside a HouseholdProvider');
  return value;
}
