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
      Kitchen: 'restaurant-outline',
      Bathroom: 'water-outline',
      Bedroom: 'bed-outline',
      'Living room': 'tv-outline',
      Laundry: 'shirt-outline',
      Hallway: 'footsteps-outline',
      Garage: 'car-outline',
      Outside: 'leaf-outline',
      Deck: 'sunny-outline',
      Roof: 'home-outline',
      'Under the house': 'layers-outline',
      // Nowhere in particular gets a plain box rather than a guess.
      Elsewhere: 'cube-outline',
    });
  });

  it('reads the rooms households add by what they are', () => {
    expect(roomIcon("Baby's Room")).toBe('bed-outline');
    expect(roomIcon("Boy's Room")).toBe('bed-outline');
    expect(roomIcon('Guest Bedroom')).toBe('bed-outline');
    expect(roomIcon('Master Bedroom')).toBe('bed-outline');
    expect(roomIcon('Study')).toBe('book-outline');
    expect(roomIcon('Playroom')).toBe('game-controller-outline');
    expect(roomIcon('Workshop')).toBe('hammer-outline');
  });

  it('reads the noun, not the qualifier', () => {
    // A garden shed is a shed, and a downstairs bathroom is a bathroom — not a
    // garden, and not a staircase.
    expect(roomIcon('Garden Shed')).toBe('hammer-outline');
    expect(roomIcon('Downstairs Bathroom')).toBe('water-outline');
  });

  it('matches whole words in any case', () => {
    expect(roomIcon('KITCHEN')).toBe('restaurant-outline');
    // "hall" is in "Marshall's room", but not as a word.
    expect(roomIcon("Marshall's room")).toBe('cube-outline');
  });

  it('gives Whole house the house', () => {
    expect(roomIcon(null)).toBe('home-outline');
  });
});
