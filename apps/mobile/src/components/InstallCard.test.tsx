import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import InstallCard from './InstallCard';

// Asked once, in a browser tab only, and never to somebody who has already
// installed it. On Android with Chrome's prompt in hand it is one tap;
// everywhere else it gives the steps.

let mock_canPrompt = false;
const mock_prompt = jest.fn().mockResolvedValue(true);
jest.mock('../hooks/useInstallPrompt', () => ({
  useInstallPrompt: () => ({ canPrompt: mock_canPrompt, prompt: () => mock_prompt() }),
}));

let mock_dismissed = false;
const mock_writeDismissed = jest.fn();
jest.mock('../lib/installState', () => {
  const actual = jest.requireActual('../lib/installState');
  return {
    ...actual,
    readInstallDismissed: () => mock_dismissed,
    writeInstallDismissed: () => mock_writeDismissed(),
  };
});

/** Everything the card says, joined, for sentences that sit in one <Text>. */
const said = (r: ReturnType<typeof render>): string =>
  r.getAllByType('Text')
    .map((node: any) => [].concat(node.props.children).filter((c) => typeof c === 'string').join(''))
    .join(' ');

const tab = (platform: 'ios' | 'android' | 'other') => ({ web: true, installed: false, platform });

const pressableAround = (r: ReturnType<typeof render>, text: string) => {
  let node: any = r.getByText(text);
  while (node && typeof node.props?.onPress !== 'function') node = node.parent;
  if (!node) throw new Error(`Nothing pressable around "${text}"`);
  return node;
};

beforeEach(() => {
  mock_canPrompt = false;
  mock_dismissed = false;
  mock_prompt.mockClear();
  mock_writeDismissed.mockClear();
});

it('gives an iPhone the Safari steps', () => {
  const r = render(<InstallCard env={tab('ios')} />);
  expect(r.getByText('Add Snag to your home screen')).toBeTruthy();
  expect(said(r)).toMatch(/In Safari, tap Share, then Add to Home Screen/);
});

it('gives Android the menu steps when Chrome has offered no prompt', () => {
  const r = render(<InstallCard env={tab('android')} />);
  expect(said(r)).toMatch(/In Chrome, open the menu/);
  expect(r.queryByText('Install')).toBeNull();
});

it('offers one-tap Install when Chrome’s prompt was caught, and goes once it is accepted', async () => {
  mock_canPrompt = true;
  const r = render(<InstallCard env={tab('android')} />);
  await TestRenderer.act(async () => pressableAround(r, 'Install').props.onPress());
  expect(mock_prompt).toHaveBeenCalledTimes(1);
  expect(r.queryByText('Add Snag to your home screen')).toBeNull();
});

it('says nothing once installed, on a desktop, or off the web build', () => {
  expect(render(<InstallCard env={{ ...tab('ios'), installed: true }} />).toJSON()).toBeNull();
  expect(render(<InstallCard env={tab('other')} />).toJSON()).toBeNull();
  expect(render(<InstallCard env={{ ...tab('android'), web: false }} />).toJSON()).toBeNull();
});

it('is dismissed for good on this device', async () => {
  const r = render(<InstallCard env={tab('ios')} />);
  let node: any = r.root.findAll((n: any) => n.props?.accessibilityLabel === 'Not now')[0];
  await TestRenderer.act(async () => node.props.onPress());
  expect(mock_writeDismissed).toHaveBeenCalledTimes(1);
  expect(r.queryByText('Add Snag to your home screen')).toBeNull();

  mock_dismissed = true;
  expect(render(<InstallCard env={tab('ios')} />).toJSON()).toBeNull();
});

it('stays on the You tab after the card was dismissed, with no ×', () => {
  mock_dismissed = true;
  const r = render(<InstallCard variant="row" env={tab('ios')} />);
  expect(r.getByText('Add Snag to your home screen')).toBeTruthy();
  expect(r.root.findAll((n: any) => n.props?.accessibilityLabel === 'Not now')).toHaveLength(0);
});
