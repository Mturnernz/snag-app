import { roomsToOffer } from '@snag/supabase-queries';
import { COMMON_ROOMS, ROOM_SUGGESTIONS } from '../types';

// *Add a room* offers the rooms a house usually has and this one hasn't, most
// common first. These pin the order that makes the likely answer the first
// card, and the comparison that decides a room is already there — which has
// to see through spelling and the other name for the same room, without
// mistaking a second bedroom for the first.

const SEEDED_TODAY = ['Kitchen', 'Laundry', 'Master bedroom'];
const SEEDED_BEFORE = [
  'Kitchen', 'Bathroom', 'Bedroom', 'Living room', 'Laundry', 'Hallway',
  'Garage', 'Outside', 'Deck', 'Roof', 'Under the house', 'Elsewhere',
];

describe('the rooms Add a room offers', () => {
  it('puts the rooms most houses have above the ones few do', () => {
    const offered = roomsToOffer([]);
    const at = (name: string) => offered.indexOf(name);
    for (const common of ['Bathroom', 'Master bedroom', 'Ensuite', 'Bedroom 2']) {
      expect(at(common)).toBeGreaterThan(-1);
      expect(at(common)).toBeLessThan(at('Conservatory'));
      expect(at(common)).toBeLessThan(at('Movie room'));
    }
    expect(at('Master bedroom')).toBeLessThan(at('Ensuite'));
  });

  it('leaves out every room the place already has, in the order it was ranked', () => {
    const offered = roomsToOffer(SEEDED_TODAY);
    for (const room of SEEDED_TODAY) expect(offered).not.toContain(room);
    // What a new place is asked about first: the bathroom, then the lounge.
    expect(offered.slice(0, 3)).toEqual(['Bathroom', 'Living room', 'Bedroom 2']);
  });

  it('sees past case, spacing, hyphens and a trailing "room"', () => {
    const offered = roomsToOffer(['BATHROOM', 'En-suite', 'Laundry room', 'dining']);
    for (const gone of ['Bathroom', 'Ensuite', 'Laundry', 'Dining room']) {
      expect(offered).not.toContain(gone);
    }
  });

  it('knows the other name for the same room', () => {
    const offered = roomsToOffer(['Lounge', 'WC', 'Office', 'Shed', 'Hall']);
    for (const gone of ['Living room', 'Toilet', 'Study', 'Garden shed', 'Hallway']) {
      expect(offered).not.toContain(gone);
    }
  });

  it('never takes a second bedroom for the first', () => {
    // "Bedroom" is inside "Bedroom 2" without being it — a house seeded with a
    // Bedroom before October still has its second and third to add.
    const offered = roomsToOffer(['Bedroom', 'Bedroom 2']);
    expect(offered).not.toContain('Bedroom 2');
    expect(offered).toContain('Bedroom 3');
    expect(offered).toContain('Master bedroom');
  });

  it('offers nothing a house that had the old twelve already has', () => {
    const offered = roomsToOffer(SEEDED_BEFORE);
    for (const room of SEEDED_BEFORE) expect(offered).not.toContain(room);
    expect(offered[0]).toBe('Master bedroom');
  });

  it('offers nothing at all once every room on the list is there', () => {
    expect(roomsToOffer(COMMON_ROOMS.map((room) => room.name))).toEqual([]);
  });

  it('has no two rooms that read as one, so neither can hide the other', () => {
    // Adding one must take exactly one card away.
    for (const room of COMMON_ROOMS) {
      const left = roomsToOffer([room.name]);
      expect(left).toHaveLength(COMMON_ROOMS.length - 1);
      expect(left).not.toContain(room.name);
    }
  });

  it('names the seeded rooms exactly as the catalogue keys them', () => {
    // A room added from a card should arrive as furnished as a seeded one, and
    // `ROOM_SUGGESTIONS` is keyed by exact name.
    const names = COMMON_ROOMS.map((room) => room.name);
    for (const seeded of Object.keys(ROOM_SUGGESTIONS).filter((r) => r !== 'Elsewhere' && r !== 'Bedroom')) {
      expect(names).toContain(seeded);
    }
  });
});
