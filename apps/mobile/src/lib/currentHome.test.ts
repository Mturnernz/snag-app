import AsyncStorage from '@react-native-async-storage/async-storage';
import { readRememberedHousehold, rememberHousehold } from './currentHome';

// Which home this device was last showing. Failure is always "nothing
// remembered", which useHousehold answers with the place last filed against —
// never a home that will not open.

beforeEach(async () => { await AsyncStorage.clear(); });

describe('the home this device is showing', () => {
  it('remembers a household and gives it back', async () => {
    await rememberHousehold('bach');
    expect(await readRememberedHousehold()).toBe('bach');
    await rememberHousehold('house');
    expect(await readRememberedHousehold()).toBe('house');
  });

  it('is nothing until something has been remembered', async () => {
    expect(await readRememberedHousehold()).toBeNull();
  });

  it('is nothing, never a throw, when storage will not answer', async () => {
    const read = jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('full'));
    expect(await readRememberedHousehold()).toBeNull();
    read.mockRestore();

    const write = jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('full'));
    await expect(rememberHousehold('bach')).resolves.toBeUndefined();
    write.mockRestore();
  });
});
