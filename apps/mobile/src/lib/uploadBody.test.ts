import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import { readForUpload } from './uploadBody';

// Reading a picked file is the first step of every upload, and the only step
// that differs by platform. It is also the step whose failure is hardest to
// see: it throws before any request is made, so the user gets "Couldn't upload
// a photo" (and a Submit button that stays disabled) while the Storage logs
// show nothing at all — which is how the web build shipped for two weeks
// unable to attach a single photo.
//
// So what's pinned here is which reader each platform gets, and that neither
// one is ever used on the other.

jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => ({
    arrayBuffer: jest.fn(async () => new Uint8Array([1, 2, 3]).buffer),
  })),
}));

const FileMock = File as unknown as jest.Mock;

const setPlatform = (os: string) => {
  (Platform as unknown as { OS: string }).OS = os;
};
const originalPlatform = Platform.OS;

beforeEach(() => {
  FileMock.mockClear();
  (global.fetch as unknown as jest.Mock | undefined)?.mockClear?.();
});

afterEach(() => setPlatform(originalPlatform));

describe('readForUpload', () => {
  it('reads a file:// URI through expo-file-system on native', async () => {
    setPlatform('ios');
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const buffer = await readForUpload('file:///tmp/photo.jpg');

    expect(new Uint8Array(buffer)).toEqual(new Uint8Array([1, 2, 3]));
    expect(FileMock).toHaveBeenCalledWith('file:///tmp/photo.jpg');
    // fetch(uri).blob() is what Storage rejected with a 400 before RLS ever
    // ran — the reason this branch exists at all.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reads a blob: URL through fetch on web', async () => {
    setPlatform('web');
    const body = new Uint8Array([4, 5, 6]).buffer;
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => body,
    })) as unknown as typeof fetch;

    const buffer = await readForUpload('blob:http://localhost:8081/abc');

    expect(new Uint8Array(buffer)).toEqual(new Uint8Array([4, 5, 6]));
    expect(global.fetch).toHaveBeenCalledWith('blob:http://localhost:8081/abc');
    // expo-file-system has no web implementation: its File is a stub missing
    // the methods the JS wrapper calls, so constructing one here throws and
    // the upload dies before it starts.
    expect(FileMock).not.toHaveBeenCalled();
  });

  it('throws rather than uploading an error response as if it were the file', async () => {
    setPlatform('web');
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 404,
      arrayBuffer: async () => new ArrayBuffer(0),
    })) as unknown as typeof fetch;

    // A revoked or expired object URL 404s. Uploading that body would store a
    // zero-byte "photo" and report success.
    await expect(readForUpload('blob:http://localhost:8081/gone')).rejects.toThrow(/404/);
  });
});
