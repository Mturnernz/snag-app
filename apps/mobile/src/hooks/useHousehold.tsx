import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Household, HouseholdMember, Profile, Property } from '../types';
import { getDefaultProperty, getMembers, getKnownRooms } from '../lib/supabase';

/**
 * The household, the people in it, the property every snag hangs off, and the
 * rooms already in use.
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
  /** Rooms already used in this household, most-used first. */
  rooms: string[];
  /** Re-reads members, property and rooms. */
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
  const [rooms, setRooms] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [nextMembers, nextProperty, nextRooms] = await Promise.all([
        getMembers(household.id),
        getDefaultProperty(household.id),
        getKnownRooms(household.id),
      ]);
      setMembers(nextMembers);
      setProperty(nextProperty);
      setRooms(nextRooms);
    } catch (err) {
      console.error('Failed to load household:', err);
    }
  }, [household.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ household, profile, members, property, rooms, refresh, reloadAccount: onReload }),
    [household, profile, members, property, rooms, refresh, onReload]
  );

  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
}

export function useHousehold(): HouseholdContextValue {
  const value = useContext(HouseholdContext);
  if (!value) throw new Error('useHousehold must be used inside a HouseholdProvider');
  return value;
}
