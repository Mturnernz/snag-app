import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import PhotoViewer from './PhotoViewer';

// The photo is the account of the problem — there is no title column in this
// app because a picture of the broken seat says what a title would. So the
// things pinned here are the ones that decide whether somebody can actually
// read a serial number off one:
//
//   - there is a way in and a way out that does not need a second finger,
//     because half the people opening this are on a desktop browser,
//   - "Fit" appears only once there is something to fit, since at fit it is a
//     control that does nothing,
//   - and a new photo opens at fit rather than somewhere in the middle of the
//     last one's zoom.

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

const onClose = jest.fn();

const byLabel = (r: ReturnType<typeof render>, label: string) =>
  r.root.findAll(
    (n: any) => typeof n.type !== 'string' && n.props?.accessibilityLabel === label
      && typeof n.props?.onPress === 'function',
    { deep: true },
  )[0];

const press = (node: any) => TestRenderer.act(() => { node.props.onPress(); });

const viewer = (photos = ['https://one.jpg'], startIndex = 0) =>
  render(<PhotoViewer visible photos={photos} startIndex={startIndex} onClose={onClose} />);

beforeEach(() => jest.clearAllMocks());

describe('getting closer without a second finger', () => {
  // A viewer whose only way in is a pinch is a viewer that does nothing at all
  // on a laptop, which is where an extract gets read and a part gets ordered.
  it('offers zoom as buttons, not only as a gesture', () => {
    const r = viewer();
    expect(byLabel(r, 'Zoom in')).toBeDefined();
    expect(byLabel(r, 'Zoom out')).toBeDefined();
  });

  it('starts fitted, with nothing to fit and no way to zoom out further', () => {
    const r = viewer();
    expect(byLabel(r, 'Fit to screen')).toBeUndefined();
    expect(byLabel(r, 'Zoom out').props.accessibilityState.disabled).toBe(true);
  });

  it('offers the way back only once there is somewhere to come back from', () => {
    const r = viewer();
    press(byLabel(r, 'Zoom in'));

    expect(byLabel(r, 'Fit to screen')).toBeDefined();
    expect(byLabel(r, 'Zoom out').props.accessibilityState.disabled).toBe(false);

    press(byLabel(r, 'Fit to screen'));
    expect(byLabel(r, 'Fit to screen')).toBeUndefined();
  });
});

describe('more than one photo', () => {
  it('says which one this is', () => {
    const r = viewer(['a.jpg', 'b.jpg', 'c.jpg'], 1);
    expect(r.queryByText('2 of 3')).not.toBeNull();
  });

  it('says nothing at all when there is only one', () => {
    const r = viewer();
    expect(r.queryByText('1 of 1')).toBeNull();
    expect(byLabel(r, 'Next photo')).toBeUndefined();
  });

  it('will not walk off either end', () => {
    const r = viewer(['a.jpg', 'b.jpg'], 0);
    expect(byLabel(r, 'Previous photo').props.accessibilityState.disabled).toBe(true);

    press(byLabel(r, 'Next photo'));
    expect(r.queryByText('2 of 2')).not.toBeNull();
    expect(byLabel(r, 'Next photo').props.accessibilityState.disabled).toBe(true);
  });

  // Carrying the last photo's zoom over opens the next one somewhere in the
  // middle of itself, with no way to tell what you are looking at.
  it('opens the next photo fitted rather than where the last one was left', () => {
    const r = viewer(['a.jpg', 'b.jpg'], 0);
    press(byLabel(r, 'Zoom in'));
    expect(byLabel(r, 'Fit to screen')).toBeDefined();

    press(byLabel(r, 'Next photo'));
    expect(byLabel(r, 'Fit to screen')).toBeUndefined();
  });
});

describe('the way out', () => {
  it('has a close button', () => {
    const r = viewer();
    press(byLabel(r, 'Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders nothing at all when it is not open', () => {
    const r = render(<PhotoViewer visible={false} photos={['a.jpg']} onClose={onClose} />);
    expect(r.toJSON()).toBeNull();
  });

  // A photo whose signed URL has not come back yet is filtered out by the
  // screens, so the list can be empty even while a strip is on screen.
  it('renders nothing rather than an empty frame when there are no photos', () => {
    const r = render(<PhotoViewer visible photos={[]} onClose={onClose} />);
    expect(r.toJSON()).toBeNull();
  });
});
