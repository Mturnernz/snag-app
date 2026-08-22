import React from 'react';
import { render } from '../test/render';
import PhotoPicker from './PhotoPicker';

// The dashed empty state and the tray used to be two different renders, and
// the Add control only existed in one of them. There is one tray now, so what
// these pin is that the Add tile is present when there are no photos at all
// (which is where the empty state used to be) and that it disappears at the
// cap — the two ends the old split got wrong in opposite directions.

jest.mock('../lib/supabase', () => ({ uploadSnagPhoto: jest.fn() }));

const MAX_PHOTOS = 5;

const addLabel = (root: ReturnType<typeof render>['root']) =>
  root.findAll(
    (n) => typeof n.props?.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Add'),
    { deep: true }
  );

describe('PhotoPicker tray', () => {
  it('offers the Add tile with no photos, where the dashed panel used to be', () => {
    const { getByText, root } = render(<PhotoPicker pathPrefix="org-1" />);
    expect(addLabel(root).length).toBeGreaterThan(0);
    expect(getByText('Add')).toBeTruthy();
    expect(getByText(`Add up to ${MAX_PHOTOS} photos`)).toBeTruthy();
  });

  it('counts photos against the cap once there are some', () => {
    const { getByText } = render(<PhotoPicker pathPrefix="org-1" initialUris={['file://a.jpg', 'file://b.jpg']} />);
    expect(getByText(`2 of ${MAX_PHOTOS} photos`)).toBeTruthy();
  });

  it('withdraws the Add tile at the cap', () => {
    const uris = Array.from({ length: MAX_PHOTOS }, (_, i) => `file://${i}.jpg`);
    const { root, queryByText } = render(<PhotoPicker pathPrefix="org-1" initialUris={uris} />);
    expect(addLabel(root)).toHaveLength(0);
    expect(queryByText('Add')).toBeNull();
  });

  it('disables adding until it knows where the photos go', () => {
    const { root } = render(<PhotoPicker pathPrefix={null} />);
    expect(addLabel(root)[0].props.disabled).toBe(true);
  });
});
