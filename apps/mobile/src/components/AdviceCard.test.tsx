import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import AdviceCard from './AdviceCard';
import type { SnagAdvice } from '../types';

// An assessment is somebody's reading of a photograph, and the whole risk in
// showing one is that it stops reading like one. So what this pins is mostly
// restraint: it says where it came from, it offers rather than writes, and the
// phone numbers it carries are never shown without the page they came from.

jest.mock('react-native/Libraries/Linking/Linking', () => ({ openURL: jest.fn(() => Promise.resolve()) }));

const advice = (over: Partial<SnagAdvice> = {}): SnagAdvice => ({
  snagId: 's1',
  diagnosis: 'The flush valve seal has perished.',
  verdict: 'diy',
  reason: null,
  steps: ['Turn the water off', 'Swap the seal'],
  parts: [{ item: 'Flush valve seal', where: 'Mitre 10', approxNzd: '12-18' }],
  trade: null,
  tradies: [],
  needToSee: null,
  source: 'Pasted 15 Sep',
  createdAt: '2026-09-15T00:00:00Z',
  ...over,
});

const onAccept = jest.fn();
const onRemove = jest.fn();

const card = (over: Partial<SnagAdvice> = {}, parts: string[] = []) =>
  render(
    <AdviceCard advice={advice(over)} parts={parts} onAccept={onAccept} onRemove={onRemove} />,
  );

const byLabel = (r: ReturnType<typeof render>, label: string) =>
  r.root.findAll(
    (n: any) => typeof n.type !== 'string' && n.props?.accessibilityLabel === label
      && !!n.props?.onPress,
    { deep: true },
  )[0];

const press = async (node: any) => {
  await TestRenderer.act(async () => { await node.props.onPress(); });
};

beforeEach(() => jest.clearAllMocks());

describe('reading as a claim', () => {
  // Nothing in this app can check any of this, so the page says where it came
  // from and when. Same argument as the invitation card saying Snag doesn't
  // email anybody: the failure is never the row, it is the unverifiable claim.
  it('says where it came from', () => {
    expect(card().queryByText('Pasted 15 Sep')).not.toBeNull();
  });

  it('can be taken off again', async () => {
    const r = card();
    await press(byLabel(r, 'Remove this assessment'));
    expect(onRemove).toHaveBeenCalled();
  });

  it('says what it would need to see when it cannot tell', () => {
    const r = card({ verdict: 'unclear', needToSee: 'the pipe under the cistern' });
    expect(r.queryByText("Can't tell from the photo")).not.toBeNull();
    expect(r.queryByText('What would help: the pipe under the cistern')).not.toBeNull();
  });
});

describe('a suggested part', () => {
  // The load-bearing one. Filling the parts list is the act that moves a snag
  // to 'doing', so a reply that wrote its own shopping lists would mark a whole
  // house as being worked on while nobody had touched anything.
  it('is an offer, and writes nothing until it is accepted', async () => {
    const r = card();
    expect(r.queryByText('Mitre 10 · about $12-18')).not.toBeNull();
    expect(onAccept).not.toHaveBeenCalled();

    await press(byLabel(r, 'Add Flush valve seal to the shopping list'));
    expect(onAccept).toHaveBeenCalledWith('Flush valve seal');
  });

  it('goes quiet once it is on the list, rather than disappearing', () => {
    // The advice still has to read as the advice it gave.
    const r = card({}, ['Flush valve seal']);
    expect(r.queryByText('Flush valve seal')).not.toBeNull();
    expect(byLabel(r, 'Add Flush valve seal to the shopping list')).toBeUndefined();
  });
});

describe('who to ring', () => {
  const trade = {
    verdict: 'trade' as const,
    trade: 'plumber',
    steps: [],
    parts: [],
    tradies: [
      {
        name: 'Real Plumbing', phone: '09 555 1234', url: 'https://real.co.nz',
        source: 'https://example.co.nz/found-here', calloutNzd: '95', totalNzd: '180-260',
      },
    ],
  };

  // Three phone numbers open on the page bury the note the other person left,
  // and the note is usually why the screen was opened.
  it('is collapsed until it is asked for', async () => {
    const r = card(trade);
    expect(r.queryByText('1 to ring')).not.toBeNull();
    expect(r.queryByText('Real Plumbing')).toBeNull();

    await press(byLabel(r, 'Show 1 to ring'));
    expect(r.queryByText('Real Plumbing')).not.toBeNull();
  });

  it('shows the two costs apart, because they are decided on differently', async () => {
    const r = card(trade);
    await press(byLabel(r, 'Show 1 to ring'));
    expect(r.queryByText('$95 to come out · $180-260 all up')).not.toBeNull();
  });

  it('never shows a name without the page it came from', async () => {
    const r = card(trade);
    await press(byLabel(r, 'Show 1 to ring'));
    expect(byLabel(r, 'Where Real Plumbing came from')).toBeDefined();
  });

  it('says once that nobody here has checked them', async () => {
    const r = card(trade);
    await press(byLabel(r, 'Show 1 to ring'));
    expect(r.root.findAll(
      (n: any) => typeof n.type === 'string' && /Nobody at this end has checked/.test(
        n.children.filter((c: any) => typeof c === 'string').join(''),
      ),
    ).length).toBeGreaterThan(0);
  });
});
