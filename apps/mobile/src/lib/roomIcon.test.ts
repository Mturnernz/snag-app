import { roomIcon } from './roomIcon';

// Rooms are free text, so the icon beside one is found from its words. These
// pin the seeded twelve, the rooms real households have added, and the order
// the rules are read in — which is what decides a Garden Shed.

describe('the icon beside a room', () => {
  it('knows every seeded room but the escape hatch', () => {
    expect({
      Kitchen: roomIcon('Kitchen'),
      Bathroom: roomIcon('Bathroom'),
      Bedroom: roomIcon('Bedroom'),
      'Living room': roomIcon('Living room'),
      Laundry: roomIcon('Laundry'),
      Hallway: roomIcon('Hallway'),
      Garage: roomIcon('Garage'),
      Outside: roomIcon('Outside'),
      Deck: roomIcon('Deck'),
      Roof: roomIcon('Roof'),
      'Under the house': roomIcon('Under the house'),
      Elsewhere: roomIcon('Elsewhere'),
    }).toEqual({
      Kitchen: 'room-kitchen',
      Bathroom: 'room-bathroom',
      Bedroom: 'room-bedroom',
      'Living room': 'room-living',
      Laundry: 'room-laundry',
      Hallway: 'room-hallway',
      Garage: 'room-garage',
      Outside: 'room-outside',
      Deck: 'room-deck',
      Roof: 'room-roof',
      'Under the house': 'room-under',
      // Nowhere in particular gets a plain box rather than a guess.
      Elsewhere: 'room-other',
    });
  });

  it('reads the rooms households add by what they are', () => {
    expect(roomIcon("Baby's Room")).toBe('room-bedroom');
    expect(roomIcon("Boy's Room")).toBe('room-bedroom');
    expect(roomIcon('Guest Bedroom')).toBe('room-bedroom');
    expect(roomIcon('Master Bedroom')).toBe('room-bedroom');
    expect(roomIcon('Study')).toBe('room-study');
    expect(roomIcon('Playroom')).toBe('room-play');
    expect(roomIcon('Workshop')).toBe('room-shed');
    expect(roomIcon('Sleepout')).toBe('room-bedroom');
    expect(roomIcon('Conservatory')).toBe('room-conservatory');
  });

  it('reads the noun, not the qualifier', () => {
    // A garden shed is a shed, and a downstairs bathroom is a bathroom — not a
    // garden, and not a staircase.
    expect(roomIcon('Garden Shed')).toBe('room-shed');
    expect(roomIcon('Downstairs Bathroom')).toBe('room-bathroom');
  });

  it('matches whole words in any case', () => {
    expect(roomIcon('KITCHEN')).toBe('room-kitchen');
    // "hall" is in "Marshall's room", but not as a word.
    expect(roomIcon("Marshall's room")).toBe('room-other');
  });

  it('gives Whole house the house', () => {
    expect(roomIcon(null)).toBe('house');
  });
});
