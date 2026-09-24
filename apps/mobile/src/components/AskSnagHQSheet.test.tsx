import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import AskSnagHQSheet from './AskSnagHQSheet';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../hooks/useKeyboardInset', () => ({ useKeyboardInset: () => 0 }));

// Asking SnagHQ shares a job with somebody outside the house, so the sheet has
// to say what is shared before anything is — and the one email, since Snag
// sends nothing else.

const texts = (r: ReturnType<typeof render>) =>
  r.getAllByType('Text').map((n: any) => {
    const flat = (x: any): string => (typeof x === 'string' ? x : (x.children ?? []).map(flat).join(''));
    return flat(n);
  });

describe('AskSnagHQSheet', () => {
  it('names what SnagHQ will see, and what it will not', () => {
    const r = render(<AskSnagHQSheet visible onSend={jest.fn()} onCancel={jest.fn()} />);
    const all = texts(r).join(' ');
    expect(all).toMatch(/photos, words and room, its notes, anything linked to it, and\s+your suburb/);
    expect(all).toMatch(/nothing else in your house/);
    expect(all).toMatch(/14 days after SnagHQ last replies/);
    expect(all).toMatch(/emails you once when they reply/);
  });

  it('will not send an empty question', () => {
    const onSend = jest.fn();
    const r = render(<AskSnagHQSheet visible onSend={onSend} onCancel={jest.fn()} />);
    const send = r.root.findAll((n: any) => n.props?.label === 'Send to SnagHQ')[0];
    expect(send.props.disabled).toBe(true);
  });

  it('sends the question trimmed', async () => {
    const onSend = jest.fn();
    const r = render(<AskSnagHQSheet visible onSend={onSend} onCancel={jest.fn()} />);
    const box = r.root.findAll((n: any) => n.props?.accessibilityLabel === 'What do you want to know?'
      && typeof n.props?.onChangeText === 'function')[0];
    await TestRenderer.act(async () => { box.props.onChangeText('  Is this safe?  '); });
    const send = r.root.findAll((n: any) => n.props?.label === 'Send to SnagHQ')[0];
    await TestRenderer.act(async () => { send.props.onPress(); });
    expect(onSend).toHaveBeenCalledWith('Is this safe?');
  });
});
