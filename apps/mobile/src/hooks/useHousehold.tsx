import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Household, HouseholdMember, Location, Profile, Property } from '../types';
import {
  getDefaultPropertyId, getLocations, getMembers, getMyProperties,
} from '../lib/supabase';
import { readRememberedHousehold, rememberHousehold } from '../lib/currentHome';

/**
 * The home being shown — its household, the people in it, its place and that
 * place's tags — and every other home this person is in.
 *
 * **A home is a household**, and one person can be in several: the house, the
 * bach, a parent's place. Each household has one place, so the place picker in
 * each tab's header is the household switcher, and `household` is whichever
 * household the active place belongs to. Screens read `household`,
 * `activeProperty` and `members` exactly as they did when there was only one.
 *
 * Loaded once rather than per screen because none of it changes often, and
 * because capture needs the property id before it can save anything. Waiting on
 * a round trip at the moment someone is holding a broken toilet seat is the one
 * place latency actually costs something.
 */
interface HouseholdContextValue {
  /** The household of the home being shown. */
  household: Household;
  /** Every household this person is in, the one they joined last first. */
  households: Household[];
  profile: Profile;
  /** The people in `household`. */
  members: HouseholdMember[];
  /** Every place this person is on — one per household, so one per home. */
  properties: Property[];
  /** The place being shown and filed against. Null only before the first load lands. */
  activeProperty: Property | null;
  /** Shows another home, and remembers it on this device. */
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
  /** Re-reads the households themselves from App.tsx — after joining, leaving or adding one. */
  reloadAccount: () => Promise<void>;
  /**
   * Hands a home just made with *Add another home* to App.tsx, which re-reads
   * the account and takes the new home through its setup steps — the rooms,
   * the invite, *You're all set* — before opening the app on it. The app
   * unmounts while it does.
   */
  setUpNewHome: (householdId: string) => Promise<void>;
}

const HouseholdContext = createContext<HouseholdContextValue | null>(null);

export function HouseholdProvider({
  households,
  profile,
  onReload,
  onHomeAdded,
  children,
}: {
  /** Never empty: App.tsx only renders the app for somebody in a household. */
  households: Household[];
  profile: Profile;
  onReload: () => Promise<void>;
  /** See `setUpNewHome`. */
  onHomeAdded: (householdId: string) => Promise<void>;
  children: React.ReactNode;
}) {
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [activePropertyId, setActivePropertyId] = useState<string | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);

  // Read inside refresh, which must not re-run every time a place is picked.
  const activeRef = useRef<string | null>(null);
  activeRef.current = activePropertyId;

  // A new array on every account read; the ids are what decide a re-read.
  const householdIds = households.map((h) => h.id).join(',');

  const loadPlaces = useCallback(async () => {
    const ids = householdIds.split(',');
    const [allProperties, remembered] = await Promise.all([
      getMyProperties(),
      readRememberedHousehold(),
    ]);
    // Only homes whose household App.tsx has read, so `household` always has
    // one to point at.
    const nextProperties = allProperties.filter((p) => ids.includes(p.householdId));
    setProperties(nextProperties);

    // The place already showing, unless something has since remembered another
    // home — joining one, or adding one — which is then the one to open on.
    const kept = nextProperties.find((p) => p.id === activeRef.current);
    const home = remembered ? nextProperties.find((p) => p.householdId === remembered) : undefined;
    const chosen = kept && (!home || kept.householdId === home.householdId) ? kept : home ?? kept;
    if (chosen) {
      setActivePropertyId(chosen.id);
      return;
    }
    // Nothing remembered on this device: ask the server which place this
    // person last actually filed against.
    setActivePropertyId(null);
    const fallback = await getDefaultPropertyId(nextProperties);
    setActivePropertyId((current) => current ?? fallback);
  }, [householdIds]);

  const activeProperty = useMemo(
    () => properties.find((p) => p.id === activePropertyId) ?? null,
    [properties, activePropertyId]
  );

  // The newest join until the places land, which for nearly everybody is the
  // only household there is.
  const household = useMemo(
    () => households.find((h) => h.id === activeProperty?.householdId) ?? households[0],
    [households, activeProperty]
  );

  // Members belong to the household being shown. A switch clears them first,
  // so the bach never lists the house's people while its own are on the way,
  // and a read that lands after another switch is dropped.
  const membersFor = useRef(household.id);
  const loadMembers = useCallback(async () => {
    const id = household.id;
    membersFor.current = id;
    try {
      const next = await getMembers(id);
      if (membersFor.current === id) setMembers(next);
    } catch (err) {
      console.error('Failed to load the household:', err);
    }
  }, [household.id]);

  useEffect(() => {
    setMembers([]);
    loadMembers();
  }, [loadMembers]);

  const refresh = useCallback(async () => {
    try {
      await Promise.all([loadPlaces(), loadMembers()]);
    } catch (err) {
      console.error('Failed to load household:', err);
    }
  }, [loadPlaces, loadMembers]);

  useEffect(() => {
    loadPlaces().catch((err) => console.error('Failed to load household:', err));
  }, [loadPlaces]);

  const setActiveProperty = useCallback((propertyId: string) => {
    setActivePropertyId(propertyId);
    const place = properties.find((p) => p.id === propertyId);
    if (place) rememberHousehold(place.householdId);
  }, [properties]);

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

  const value = useMemo(
    () => ({
      household,
      households,
      profile,
      members,
      properties,
      activeProperty,
      setActiveProperty,
      locations,
      reloadLocations,
      refresh,
      reloadAccount: onReload,
      setUpNewHome: onHomeAdded,
    }),
    [
      household, households, profile, members, properties, activeProperty, setActiveProperty,
      locations, reloadLocations, refresh, onReload, onHomeAdded,
    ]
  );

  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
}

export function useHousehold(): HouseholdContextValue {
  const value = useContext(HouseholdContext);
  if (!value) throw new Error('useHousehold must be used inside a HouseholdProvider');
  return value;
}
