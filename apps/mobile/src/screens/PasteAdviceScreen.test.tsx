import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import PasteAdviceScreen from './PasteAdviceScreen';

// The return half of a briefed extract. A paste is a blob of somebody else's
// text naming a dozen jobs, so the two things worth pinning are that it cannot
// write anything before somebody has seen what it would change, and that a
// reference nobody here recognises is said out loud rather than skipped.

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
const mock_goBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mock_goBack, navigate: jest.fn() }),
}));
jest.mock('../hooks/useKeyboardInset', () => ({ useKeyboardInset: () => 0 }));

const mock_getSnags = jest.fn();
const mock_recordSnagAdvice = jest.fn();
const mock_updateSnag = jest.fn();
jest.mock('../lib/supabase', () => ({
  getSnags: (...a: unknown[]) => mock_getSnags(...a),
  recordSnagAdvice: (...a: unknown[]) => mock_recordSnagAdvice(...a),
  updateSnag: (...a: unknown[]) => mock_updateSnag(...a),
}));
const mock_showToast = jest.fn();
jest.mock('../hooks/useToast', () => ({ useToast: () => ({ showToast: mock_showToast }) }));
const mock_showAlert = jest.fn();
jest.mock('../lib/alert', () => ({ showAlert: (...a: unknown[]) => mock_showAlert(...a) }));
// A stable object, deliberately: a fresh literal per call would change the
// identity `load`'s useCallback depends on and spin the screen forever — which
// is the shape of the bug, not of the test.
const HOUSEHOLD = {
  activeProperty: { id: 'p', householdId: 'h', name: 'Home', suburb: null, town: null },
};
jest.mock('../hooks/useHousehold', () => ({ useHousehold: () => HOUSEHOLD }));

const snag = (over: Partial<any>): any => ({
  id: 'x', reference: 'SNAG-0001', householdId: 'h', propertyId: 'p',
  room: null, photoPaths: [], description: 'The cistern drips', priority: null,
  status: 'open', parts: [], needsParts: false, dueAt: null, repeatDays: null,
  assigneeId: null, reporterId: 'me', createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z', lastDoneAt: null, doneAt: null,
  propertyName: 'Home', reporterName: 'Me', assigneeName: null, commentCount: 0,
  ...over,
});

const REPLY = (body: string) => `Here's what I found.\n\n\`\`\`snag-actions\n${body}\n\`\`\``;

const ONE = REPLY(JSON.stringify({
  'SNAG-0042': {
    diagnosis: 'Perished flush valve seal',
    verdict: 'diy',
    steps: ['Turn the water off'],
    parts: [{ item: 'Flush valve seal', where: 'Mitre 10', approx_nzd: '12-18' }],
  },
}));

const settle = () => TestRenderer.act(async () => {});

async function arrange(snags: any[] = [snag({ id: 'a', reference: 'SNAG-0042' })]) {
  mock_getSnags.mockResolvedValue(snags);
  const r = render(<PasteAdviceScreen />);
  await settle();
  return r;
}

const byLabel = (r: ReturnType<typeof render>, label: string) =>
  r.root.findAll(
    (n: any) => typeof n.type !== 'string' && n.props?.accessibilityLabel === label,
    { deep: true },
  )[0];

const button = (r: ReturnType<typeof render>, label: string) =>
  r.root.findAll((n: any) => typeof n.type !== 'string' && n.props?.label === label)[0];

const type = async (r: ReturnType<typeof render>, text: string) => {
  TestRenderer.act(() => { byLabel(r, 'The reply').props.onChangeText(text); });
  await settle();
};

const press = async (node: any) => {
  await TestRenderer.act(async () => { await node.props.onPress(); });
};

beforeEach(() => jest.clearAllMocks());

describe('reading a reply', () => {
  it('writes nothing until the changes have been looked at', async () => {
    const r = await arrange();
    await type(r, ONE);
    await press(button(r, 'Read it'));

    // Read, matched, listed — and nothing saved.
    expect(r.queryByText('1 job answered')).not.toBeNull();
    expect(mock_recordSnagAdvice).not.toHaveBeenCalled();

    await press(button(r, 'Update 1 job'));
    expect(mock_recordSnagAdvice).toHaveBeenCalledTimes(1);
  });

  it('files the answer without touching the snag', async () => {
    // update_snag moves a job to 'doing' the moment parts change, so applying a
    // reply through it would mark a whole house as being worked on.
    const r = await arrange();
    await type(r, ONE);
    await press(button(r, 'Read it'));
    await press(button(r, 'Update 1 job'));

    const [snagId, advice, source] = mock_recordSnagAdvice.mock.calls[0];
    expect(snagId).toBe('a');
    expect(advice.diagnosis).toBe('Perished flush valve seal');
    expect(advice.parts).toEqual([
      { item: 'Flush valve seal', where: 'Mitre 10', approxNzd: '12-18' },
    ]);
    // The reference did its job in the matching and does not need storing.
    expect(advice).not.toHaveProperty('reference');
    expect(source).toMatch(/^Pasted /);
    expect(mock_updateSnag).not.toHaveBeenCalled();
  });

  it('names a reference that is not on this list', async () => {
    const r = await arrange();
    await type(r, REPLY(JSON.stringify({
      'SNAG-0042': { diagnosis: 'Perished seal' },
      'SNAG-9999': { diagnosis: 'Not from this house' },
    })));
    await press(button(r, 'Read it'));

    expect(r.queryByText("SNAG-9999 isn't on this list, so it was left out.")).not.toBeNull();
    await press(button(r, 'Update 1 job'));
    expect(mock_recordSnagAdvice).toHaveBeenCalledTimes(1);
  });

  it('leaves out a row that has been unticked', async () => {
    const r = await arrange([
      snag({ id: 'a', reference: 'SNAG-0042' }),
      snag({ id: 'b', reference: 'SNAG-0043', description: 'Gutters' }),
    ]);
    await type(r, REPLY(JSON.stringify({
      'SNAG-0042': { diagnosis: 'Perished seal' },
      'SNAG-0043': { diagnosis: 'Full of leaves' },
    })));
    await press(button(r, 'Read it'));
    await press(byLabel(r, 'SNAG-0043, Gutters'));
    await press(button(r, 'Update 1 job'));

    expect(mock_recordSnagAdvice).toHaveBeenCalledTimes(1);
    expect(mock_recordSnagAdvice.mock.calls[0][0]).toBe('a');
  });

  it('says how far it got when a write fails part way', async () => {
    // Twelve rows is twelve writes, and "some of that didn't save" with no
    // count leaves somebody re-pasting the lot.
    const r = await arrange([
      snag({ id: 'a', reference: 'SNAG-0042' }),
      snag({ id: 'b', reference: 'SNAG-0043' }),
    ]);
    mock_recordSnagAdvice
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('Network'));
    await type(r, REPLY(JSON.stringify({
      'SNAG-0042': { diagnosis: 'Perished seal' },
      'SNAG-0043': { diagnosis: 'Full of leaves' },
    })));
    await press(button(r, 'Read it'));
    await press(button(r, 'Update 2 jobs'));

    expect(mock_showAlert).toHaveBeenCalledWith('Saved 1 of 2', 'Network');
    expect(mock_goBack).not.toHaveBeenCalled();
  });

  it('says which way the paste failed', async () => {
    const r = await arrange();
    await type(r, 'It looks like a plumbing job to me.');
    await press(button(r, 'Read it'));
    expect(r.queryByText(
      'No snag-actions block in that. Paste the whole reply, including the block at the end.',
    )).not.toBeNull();
  });
});
