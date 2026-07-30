import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import { readForUpload } from './uploadBody';

// Reading a picked file is the first step of every upload, and the only step
// that differs by platform. It is also the step whose failure is hardest to
// see: it happens before any request, so the user gets "Couldn't upload a
// photo" (and a Submit button that stays disabled) while the Storage logs show
// nothing at all — which is how the web build shipped for two weeks unable to
// attach a single photo.
//
// What each platform gets is not a detail. storage-js sends a Blob as
// multipart/form-data and anything else as a raw binary body, so this function
// also decides which of the two upload paths the request takes.

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
  it('reads a file:// URI as an ArrayBuffer on native', async () => {
    setPlatform('ios');
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const body = await readForUpload('file:///tmp/photo.jpg', 'image/jpeg');

    expect(new Uint8Array(body as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]));
    expect(FileMock).toHaveBeenCalledWith('file:///tmp/photo.jpg');
    // A Blob here is what Storage rejected with a 400 before RLS ever ran —
    // the reason this branch exists at all.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reads a blob: URL as a Blob on web, so the upload goes as multipart', async () => {
    setPlatform('web');
    const blob = new Blob([new Uint8Array([4, 5, 6])], { type: 'image/jpeg' });
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, blob: async () => blob })) as unknown as typeof fetch;

    const body = await readForUpload('blob:http://localhost:8081/abc', 'image/jpeg');

    expect(body).toBe(blob);
    expect(global.fetch).toHaveBeenCalledWith('blob:http://localhost:8081/abc');
    // expo-file-system has no web implementation: its File is a stub missing
    // the methods the JS wrapper calls, so constructing one here throws and
    // the upload dies before it starts.
    expect(FileMock).not.toHaveBeenCalled();
  });

  it('retypes a blob that lost its mime type, so it is not stored as octet-stream', async () => {
    setPlatform('web');
    const untyped = new Blob([new Uint8Array([7])], { type: '' });
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, blob: async () => untyped })) as unknown as typeof fetch;

    const body = (await readForUpload('blob:x', 'application/pdf')) as Blob;

    // Multipart carries the Blob's own type, not storage-js's contentType
    // option — an untyped blob downloads as a file nothing will open.
    expect(body.type).toBe('application/pdf');
  });

  it('leaves a correctly typed blob alone', async () => {
    setPlatform('web');
    const blob = new Blob([new Uint8Array([8])], { type: 'application/pdf' });
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, blob: async () => blob })) as unknown as typeof fetch;

    expect(await readForUpload('blob:x', 'application/pdf')).toBe(blob);
  });

  it('throws rather than uploading an error response as if it were the file', async () => {
    setPlatform('web');
    global.fetch = jest.fn(async () => ({
      ok: false, status: 404, blob: async () => new Blob([]),
    })) as unknown as typeof fetch;

    // A revoked or expired object URL 404s. Uploading that body would store a
    // zero-byte "photo" and report success.
    await expect(readForUpload('blob:http://localhost:8081/gone')).rejects.toThrow(/404/);
  });
});
