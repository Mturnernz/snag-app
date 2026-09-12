import React from 'react';
import { render } from '../test/render';
import PhotoPicker from './PhotoPicker';

// The tray offers both sources directly. It used to offer one "Add" tile that
// opened a three-way dialog — which `showAlert` cannot express on web (see
// lib/alert.ts), so the web build short-circuited straight to the library and
// the camera was unreachable on the platform the app is actually installed on.
//
// What these pin: both tiles are present when there are no photos at all, both
// disappear at the cap, and neither is usable before the upload path knows
// where photos go.

jest.mock('../lib/supabase', () => ({ uploadSnagPhoto: jest.fn() }));

const MAX_PHOTOS = 5;

// Host nodes only. A TouchableOpacity forwards its accessibility props down
// five levels of composite, so matching on the label alone counts each tile
// five times; the single host View is the tile itself. `disabled` doesn't
// survive the trip either — it arrives as accessibilityState.
const sourceTiles = (root: ReturnType<typeof render>['root']) =>
  root.findAll(
    (n) =>
      typeof n.type === 'string' &&
      typeof n.props?.accessibilityLabel === 'string' &&
      (n.props.accessibilityLabel.startsWith('Take a photo') ||
        n.props.accessibilityLabel.startsWith('Choose from your library')),
    { deep: true }
  );

describe('PhotoPicker tray', () => {
  it('offers both sources with no photos, rather than one tile behind a dialog', () => {
    const { getByText, root } = render(<PhotoPicker pathPrefix="org-1" />);
    expect(sourceTiles(root)).toHaveLength(2);
    expect(getByText('Camera')).toBeTruthy();
    expect(getByText('Library')).toBeTruthy();
    expect(getByText(`Add up to ${MAX_PHOTOS} photos`)).toBeTruthy();
  });

  it('counts photos against the cap once there are some', () => {
    const { getByText } = render(<PhotoPicker pathPrefix="org-1" initialUris={['file://a.jpg', 'file://b.jpg']} />);
    expect(getByText(`2 of ${MAX_PHOTOS} photos`)).toBeTruthy();
  });

  it('withdraws both tiles at the cap', () => {
    const uris = Array.from({ length: MAX_PHOTOS }, (_, i) => `file://${i}.jpg`);
    const { root, queryByText } = render(<PhotoPicker pathPrefix="org-1" initialUris={uris} />);
    expect(sourceTiles(root)).toHaveLength(0);
    expect(queryByText('Camera')).toBeNull();
    expect(queryByText('Library')).toBeNull();
  });

  it('disables both until it knows where the photos go', () => {
    const { root } = render(<PhotoPicker pathPrefix={null} />);
    const tiles = sourceTiles(root);
    expect(tiles).toHaveLength(2);
    tiles.forEach((tile) => expect(tile.props.accessibilityState.disabled).toBe(true));
  });
});
