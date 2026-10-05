import React from 'react';
import TestRenderer from 'react-test-renderer';
import { cleanup, render } from '../test/render';
import { HouseholdProvider, useHousehold } from './useHousehold';

// A home is a household, and one person can be in several. The provider shows
// one at a time: the household is whichever one the active place belongs to,
// so the place picker in each header is the household switcher. Three rules
// make that honest, and each is one line away from breaking:
//
// - the household and its people follow the place, so the bach never shows the
//   house's people;
// - the home somebody was last looking at, on this device, is the one that opens;
// - a place picked inside a household with two places (the shape before Martins
//   Bay became its own household) is not pulled back to the household's first.

const mock = {
  getMyProperties: jest.fn(),
  getMembers: jest.fn(),
  getLocations: jest.fn(),
  getDefaultPropertyId: jest.fn(),
  readRememberedHousehold: jest.fn(),
  rememberHousehold: jest.fn(),
};
jest.mock('../lib/supabase', () => ({
  getMyProperties: (...a: unknown[]) => mock.getMyProperties(...a),
  getMembers: (...a: unknown[]) => mock.getMembers(...a),
  getLocations: (...a: unknown[]) => mock.getLocations(...a),
  getDefaultPropertyId: (...a: unknown[]) => mock.getDefaultPropertyId(...a),
}));
jest.mock('../lib/currentHome', () => ({
  readRememberedHousehold: (...a: unknown[]) => mock.readRememberedHousehold(...a),
  rememberHousehold: (...a: unknown[]) => mock.rememberHousehold(...a),
}));

const HOUSE = { id: 'house', name: '32 Le Roy', createdAt: '2026-09-12T00:00:00Z' };
const BACH = { id: 'bach', name: 'Martins Bay', createdAt: '2026-10-05T00:00:00Z' };
const HOUSE_PLACE = { id: 'p-house', householdId: 'house', name: '32 Le Roy', suburb: null, town: null, memberCount: 2 };
const BACH_PLACE = { id: 'p-bach', householdId: 'bach', name: 'Martins Bay', suburb: null, town: null, memberCount: 2 };
const PROFILE = { id: 'me', displayName: 'Mike', createdAt: '', projectsEnabled: true, setupSeen: [] } as any;

let seen: ReturnType<typeof useHousehold>;
function Probe() {
  seen = useHousehold();
  return null;
}

const settle = () => TestRenderer.act(async () => {});

async function mount(households = [BACH, HOUSE]) {
  render(
    <HouseholdProvider households={households} profile={PROFILE} onReload={jest.fn()}>
      <Probe />
    </HouseholdProvider>
  );
  await settle();
  await settle();
}

afterEach(cleanup);

beforeEach(() => {
  jest.clearAllMocks();
  mock.getMyProperties.mockResolvedValue([HOUSE_PLACE, BACH_PLACE]);
  mock.getMembers.mockImplementation(async (id: string) => [
    { householdId: id, profileId: `${id}-person`, displayName: `${id} person`, role: 'owner' },
  ]);
  mock.getLocations.mockResolvedValue([]);
  mock.getDefaultPropertyId.mockResolvedValue('p-house');
  mock.readRememberedHousehold.mockResolvedValue(null);
});

describe('HouseholdProvider', () => {
  it("shows the active place's household and its people, not the newest join", async () => {
    // Nothing remembered: the place they last filed a job against, which is the
    // house — even though the bach is the household they joined most recently.
    await mount();

    expect(seen.activeProperty?.id).toBe('p-house');
    expect(seen.household.id).toBe('house');
    expect(seen.members.map((m) => m.householdId)).toEqual(['house']);
    expect(seen.properties.map((p) => p.id)).toEqual(['p-house', 'p-bach']);
  });

  it('switches household and people with the place, and remembers it', async () => {
    await mount();
    await TestRenderer.act(async () => seen.setActiveProperty('p-bach'));
    await settle();

    expect(seen.household.id).toBe('bach');
    expect(mock.getMembers).toHaveBeenLastCalledWith('bach');
    expect(seen.members.map((m) => m.householdId)).toEqual(['bach']);
    expect(mock.rememberHousehold).toHaveBeenCalledWith('bach');
  });

  it('opens on the home remembered on this device, without asking the server', async () => {
    mock.readRememberedHousehold.mockResolvedValue('bach');
    await mount();

    expect(seen.activeProperty?.id).toBe('p-bach');
    expect(seen.household.id).toBe('bach');
    expect(mock.getDefaultPropertyId).not.toHaveBeenCalled();
  });

  it('moves to a home remembered after it opened — one just joined or added', async () => {
    await mount();
    expect(seen.household.id).toBe('house');

    mock.readRememberedHousehold.mockResolvedValue('bach');
    await TestRenderer.act(async () => seen.refresh());
    await settle();

    expect(seen.household.id).toBe('bach');
  });

  it('keeps a picked place inside a household that still has two', async () => {
    // Before the split, the bach was a second place in the house's household.
    // Remembering the household must not pull the bach back to the house.
    const both = { ...BACH_PLACE, householdId: 'house' };
    mock.getMyProperties.mockResolvedValue([HOUSE_PLACE, both]);
    mock.readRememberedHousehold.mockResolvedValue('house');
    await mount([HOUSE]);

    await TestRenderer.act(async () => seen.setActiveProperty('p-bach'));
    await TestRenderer.act(async () => seen.refresh());
    await settle();

    expect(seen.activeProperty?.id).toBe('p-bach');
    expect(seen.household.id).toBe('house');
  });

  it('leaves out a place whose household has not been read', async () => {
    // A place in a household App.tsx does not know about would leave
    // `household` with nothing to point at.
    await mount([HOUSE]);
    expect(seen.properties.map((p) => p.id)).toEqual(['p-house']);
  });
});
