import { serviceJobFor } from '@snag/supabase-queries';
import { fileServiceJob } from './serviceJob';

// One repeating job per serviced thing, and the thing page finds it here. It
// used to file a new one on every press, and stop none of them.

const mock_createSnag = jest.fn();
jest.mock('./supabase', () => ({ createSnag: (...a: unknown[]) => mock_createSnag(...a) }));

const snag = (over: Partial<any> = {}): any => ({
  id: 's', status: 'open', thingId: null, linkedThings: [], repeatDays: null, dueAt: null, ...over,
});

const thing = (over: Partial<any> = {}): any => ({
  id: 't1', propertyId: 'p', room: 'Living room', name: 'Heat pump', make: null, model: null,
  serviceDays: null, spec: {}, ...over,
});

beforeEach(() => jest.clearAllMocks());

describe('serviceJobFor', () => {
  it('finds the open repeating job about this thing, by either link', () => {
    expect(serviceJobFor([snag({ id: 'a', thingId: 't1', repeatDays: 180 })], 't1')?.id).toBe('a');
    expect(serviceJobFor([snag({ id: 'b', linkedThings: [{ id: 't1' }], repeatDays: 365 })], 't1')?.id)
      .toBe('b');
  });

  it('ignores a one-off, a finished job, and one about something else', () => {
    expect(serviceJobFor([
      snag({ thingId: 't1' }),
      snag({ thingId: 't1', repeatDays: 180, status: 'done' }),
      snag({ thingId: 't2', repeatDays: 180 }),
    ], 't1')).toBeNull();
  });

  it('takes the soonest due when an older duplicate still exists', () => {
    const found = serviceJobFor([
      snag({ id: 'late', thingId: 't1', repeatDays: 180, dueAt: '2027-06-01T00:00:00Z' }),
      snag({ id: 'soon', thingId: 't1', repeatDays: 180, dueAt: '2027-01-01T00:00:00Z' }),
    ], 't1');
    expect(found?.id).toBe('soon');
  });
});

describe('fileServiceJob', () => {
  it('files nothing for a thing that is not serviced', async () => {
    expect(await fileServiceJob(thing())).toBeNull();
    expect(mock_createSnag).not.toHaveBeenCalled();
  });

  // Created dated and repeating in one call, so it arrives open rather than
  // as a job somebody has started.
  it('files one dated, repeating job a cycle out, about the thing and in its room', async () => {
    mock_createSnag.mockResolvedValue({ id: 'new' });
    const said = await fileServiceJob(thing({ serviceDays: 365, spec: { servicedBy: 'Cool Co' } }));

    expect(mock_createSnag).toHaveBeenCalledTimes(1);
    const input = mock_createSnag.mock.calls[0][0];
    expect(input).toMatchObject({
      propertyId: 'p', room: 'Living room', thingId: 't1', repeatDays: 365,
      description: 'Service the heat pump · Cool Co',
    });
    const days = Math.round((new Date(input.dueAt).getTime() - Date.now()) / 86_400_000);
    expect(days).toBeGreaterThanOrEqual(364);
    expect(said).toBe('Service on the list · every year');
  });

  it('says so rather than throwing when the job cannot be filed', async () => {
    mock_createSnag.mockRejectedValue(new Error('Network'));
    const said = await fileServiceJob(thing({ serviceDays: 180 }));
    expect(said).toMatch(/couldn't be added/);
  });
});
