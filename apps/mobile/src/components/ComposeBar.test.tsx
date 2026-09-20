import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render, flattenStyle } from '../test/render';
import ComposeBar from './ComposeBar';

// The bar replaced a whole tab, so what it has to get right is the cheap path:
// a line of text is a complete snag, the words come back if the send fails, and
// it lifts for the keyboard — the case `KeyboardAvoidingView` has never handled
// in a browser, and the one thing this component could not exist without.

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));

const mock_takePhoto = jest.fn();
const mock_compressAndUpload = jest.fn();
jest.mock('../lib/photoUpload', () => ({
  takePhoto: (...a: unknown[]) => mock_takePhoto(...a),
  compressAndUpload: (...a: unknown[]) => mock_compressAndUpload(...a),
  photoFileName: () => 'house-1/1.jpg',
}));

const mock_showAlert = jest.fn();
jest.mock('../lib/alert', () => ({ showAlert: (...a: unknown[]) => mock_showAlert(...a) }));

let mock_inset = 0;
jest.mock('../hooks/useKeyboardInset', () => ({ useKeyboardInset: () => mock_inset }));

const field = (r: ReturnType<typeof render>) => r.getAllByType('TextInput')[0];

const labelled = (r: ReturnType<typeof render>, label: string) => {
  const found = r.root.findAll(
    (n) => typeof n.type !== 'string' && n.props?.accessibilityLabel === label && !!n.props?.onPress,
    { deep: true }
  );
  if (found.length === 0) throw new Error(`Nothing pressable labelled "${label}"`);
  return found[0];
};

/** The bar itself — the outermost host View carrying the lift. */
const bar = (r: ReturnType<typeof render>) =>
  flattenStyle(
    r.root.findAll((n) => typeof n.type === 'string' && flattenStyle(n.props?.style).borderTopWidth === 1, {
      deep: true,
    })[0].props.style
  );

beforeEach(() => {
  jest.clearAllMocks();
  mock_inset = 0;
});

describe('ComposeBar', () => {
  it('files a line of text as a whole snag, with no photo', async () => {
    const onAdd = jest.fn().mockResolvedValue(undefined);
    const result = render(<ComposeBar pathPrefix="house-1" onAdd={onAdd} />);

    await TestRenderer.act(async () => field(result).props.onChangeText('Gutters'));
    await TestRenderer.act(async () => labelled(result, 'Add to the list').props.onPress());

    expect(onAdd).toHaveBeenCalledWith({ photoPath: null, description: 'Gutters' });
  });

  it('gives the words back when the send fails', async () => {
    const onAdd = jest.fn().mockRejectedValue(new Error('no connection'));
    const result = render(<ComposeBar pathPrefix="house-1" onAdd={onAdd} />);

    await TestRenderer.act(async () => field(result).props.onChangeText('Gutters'));
    await TestRenderer.act(async () => labelled(result, 'Add to the list').props.onPress());

    expect(mock_showAlert).toHaveBeenCalled();
    // Retyping what you just typed is the worst possible answer to a failure.
    expect(field(result).props.value).toBe('Gutters');
  });

  it('carries words already in the bar onto the photo', async () => {
    mock_takePhoto.mockResolvedValue('file://shot.jpg');
    mock_compressAndUpload.mockResolvedValue({ path: 'house-1/1.jpg', error: null });
    const onAdd = jest.fn().mockResolvedValue(undefined);
    const result = render(<ComposeBar pathPrefix="house-1" onAdd={onAdd} />);

    await TestRenderer.act(async () => field(result).props.onChangeText('Hinge sheared off'));
    await TestRenderer.act(async () => labelled(result, 'Take a photo').props.onPress());

    // Typing and then reaching for the camera meant one snag, not two.
    expect(onAdd).toHaveBeenCalledWith({ photoPath: 'house-1/1.jpg', description: 'Hinge sheared off' });
  });

  it('is only ever a way to file something new', async () => {
    // The bar used to double as the note field for the snag just added: after a
    // photo its placeholder changed and so did the meaning of pressing send.
    // Nobody noticed, so people filed a photo and then opened the snag again to
    // describe it. AmendSnagSheet asks in words now, and this bar has one job.
    const onAdd = jest.fn().mockResolvedValue(undefined);
    const result = render(<ComposeBar pathPrefix="house-1" onAdd={onAdd} />);

    // The prompt never changes meaning, and the send button says one thing.
    // It reads as the alternative to the camera now rather than as the bar's
    // main offer, because a photograph *is* the snag and typing is the one
    // with a keyboard in front of it.
    expect(field(result).props.placeholder).toBe('or type it…');

    await TestRenderer.act(async () => field(result).props.onChangeText('Gutters'));
    await TestRenderer.act(async () => labelled(result, 'Add to the list').props.onPress());

    expect(onAdd).toHaveBeenCalledWith({ photoPath: null, description: 'Gutters' });
  });

  it('refuses the camera until it knows where photos go', async () => {
    const result = render(<ComposeBar pathPrefix={null} onAdd={jest.fn()} />);
    await TestRenderer.act(async () => labelled(result, 'Take a photo').props.onPress());
    expect(mock_takePhoto).not.toHaveBeenCalled();
  });

  it('lifts for the keyboard, and drops the safe-area inset while it is up', () => {
    const stacked = render(<ComposeBar pathPrefix="house-1" onAdd={jest.fn()} stacked />);
    // Stacked above a tab bar, which already owns the home indicator.
    expect(bar(stacked).marginBottom).toBe(0);

    mock_inset = 291;
    const lifted = render(<ComposeBar pathPrefix="house-1" onAdd={jest.fn()} />);
    const style = bar(lifted);
    expect(style.marginBottom).toBe(291);
    // 34 + padding would lift it a whole home indicator too far: the keyboard
    // already covers the inset it would otherwise clear.
    expect(style.paddingBottom).toBe(8);
  });
});

// ---------------------------------------------------------------- camera first
//
// It was an icon-only circle the same size as the send button, beside a field
// inviting words — which made photographing and typing read as two equal
// offers. Nearly everything worth filing is in front of somebody when they
// file it, so the shutter carries a word and the field is the alternative.

describe('which way of filing is the default', () => {
  it('names the camera on the button rather than leaving it an icon', () => {
    const result = render(<ComposeBar pathPrefix="house-1" onAdd={jest.fn()} />);
    const camera = labelled(result, 'Take a photo');

    const words = camera.findAllByType('Text' as any).map((n: any) => n.props.children);
    expect(words).toContain('Photo');
  });

  it('still reaches the camera in one tap, never a chooser', async () => {
    mock_takePhoto.mockClear();
    const result = render(<ComposeBar pathPrefix="house-1" onAdd={jest.fn()} />);
    await TestRenderer.act(async () => labelled(result, 'Take a photo').props.onPress());
    expect(mock_takePhoto).toHaveBeenCalled();
  });
});
