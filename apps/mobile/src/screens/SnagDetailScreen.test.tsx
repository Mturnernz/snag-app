import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import SnagDetailScreen from './SnagDetailScreen';

// Finishing something is the one moment this app says well done, and the whole
// risk is saying it about a job that is still on the list: a repeating snag
// never reaches 'done' — `set_snag_status` rolls `due_at` forward and leaves it
// open — so the two outcomes have to stay told apart at the one place that can
// tell them apart, which is the row that came back from the write.

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
const mock_goBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mock_goBack, navigate: jest.fn() }),
  useRoute: () => ({ params: { snagId: 's1' } }),
}));
jest.mock('../hooks/useKeyboardInset', () => ({ useKeyboardInset: () => 0 }));
jest.mock('../components/PhotoViewer', () => ({ __esModule: true, default: () => null }));

const mock_getSnag = jest.fn();
const mock_setSnagStatus = jest.fn();
const mock_updateSnag = jest.fn();
const mock_setPartBought = jest.fn().mockResolvedValue(undefined);
jest.mock('../lib/supabase', () => ({
  getSnag: (...a: unknown[]) => mock_getSnag(...a),
  getComments: jest.fn().mockResolvedValue([]),
  addComment: jest.fn(),
  updateSnag: (...a: unknown[]) => mock_updateSnag(...a),
  setSnagStatus: (...a: unknown[]) => mock_setSnagStatus(...a),
  setPartBought: (...a: unknown[]) => mock_setPartBought(...a),
  deleteSnag: jest.fn(),
  getFileUrls: jest.fn().mockResolvedValue({}),
  deleteStoredFiles: jest.fn(),
  getSnagAdvice: jest.fn().mockResolvedValue(null),
  deleteSnagAdvice: jest.fn(),
}));
const mock_showToast = jest.fn();
jest.mock('../hooks/useToast', () => ({ useToast: () => ({ showToast: mock_showToast }) }));
jest.mock('../lib/alert', () => ({ showAlert: jest.fn() }));
// Prefixed `mock_` so jest's module factory may reference it, and stable so a
// fresh literal per render cannot spin the screen's effects.
const mock_household = {
  members: [{ profileId: 'me', displayName: 'Me' }],
  profile: { id: 'me', displayName: 'Me' },
  locations: [],
  refresh: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../hooks/useHousehold', () => ({ useHousehold: () => mock_household }));

const DAY = 86_400_000;
const ahead = (days: number) => new Date(Date.now() + days * DAY).toISOString();

const snag = (over: Partial<any> = {}): any => ({
  id: 's1', reference: 'SNAG-0041', householdId: 'h', propertyId: 'p',
  room: 'Bathroom', photoPaths: [], description: 'Toilet cistern keeps running',
  status: 'open', priority: null, parts: [], bought: [], needsParts: false,
  dueAt: null, repeatDays: null, assigneeId: null, thingId: null,
  thingName: null, thingMake: null, thingModel: null,
  reporterId: 'me', reporterName: 'Me', assigneeName: null, propertyName: 'Home',
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
  lastDoneAt: null, doneAt: null, commentCount: 0,
  ...over,
});

const settle = () => TestRenderer.act(async () => {});

async function arrange(row = snag()) {
  mock_getSnag.mockResolvedValue(row);
  const r = render(<SnagDetailScreen />);
  await settle();
  return r;
}

const button = (r: ReturnType<typeof render>, label: string) =>
  r.root.findAll((n: any) => typeof n.type !== 'string' && n.props?.label === label)[0];

const press = async (node: any) => {
  await TestRenderer.act(async () => { await node.props.onPress(); });
};

beforeEach(() => jest.clearAllMocks());

describe('finishing a snag', () => {
  it('says congratulations, and offers the list back', async () => {
    const r = await arrange();
    mock_setSnagStatus.mockResolvedValue(snag({ status: 'done', doneAt: new Date().toISOString() }));

    await press(button(r, 'Mark done'));

    expect(r.queryByText('Congratulations')).not.toBeNull();
    expect(r.queryByText('Toilet cistern keeps running is done. One less thing.')).not.toBeNull();

    await press(button(r, 'Return to list'));
    expect(mock_goBack).toHaveBeenCalled();
  });

  // The load-bearing case. A repeating job is back on the list before the phone
  // is down, so a dialog saying well done would be the app claiming something
  // the list flatly contradicts.
  it('does not congratulate a repeating job that only rolled forward', async () => {
    const r = await arrange(snag({ repeatDays: 180, dueAt: ahead(1) }));
    mock_setSnagStatus.mockResolvedValue(snag({
      repeatDays: 180, status: 'open', dueAt: ahead(180), lastDoneAt: new Date().toISOString(),
    }));

    await press(button(r, 'Mark done'));

    expect(r.queryByText('Congratulations')).toBeNull();
    // It keeps the toast that says what actually happened.
    expect(mock_showToast).toHaveBeenCalledWith(expect.stringContaining('back on the list'));
    expect(mock_goBack).not.toHaveBeenCalled();
  });

  it('says nothing when a done snag is reopened', async () => {
    const r = await arrange(snag({ status: 'done', doneAt: '2026-09-10T00:00:00Z' }));
    mock_setSnagStatus.mockResolvedValue(snag({ status: 'open' }));

    await press(button(r, 'Reopen'));

    expect(r.queryByText('Congratulations')).toBeNull();
    expect(mock_showToast).not.toHaveBeenCalled();
  });
});
