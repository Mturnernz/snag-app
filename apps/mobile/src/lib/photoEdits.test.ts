import {
  PHOTO_UNDO_MS, deleteFileLater, keepFile, withoutPhoto, withPhotoBack,
} from './photoEdits';
import { TOAST_ACTION_MS } from '../hooks/useToast';

// Taking a photo off writes the row at once and lets the file go later, so
// *Undo* can put the path back and find the picture still there. The one
// failure that matters is the file going while Undo is still on screen: Undo
// would then put back a path to nothing, a blank tile on both phones.

const mock_deleteStoredFiles = jest.fn().mockResolvedValue(undefined);
jest.mock('./supabase', () => ({
  deleteStoredFiles: (...a: unknown[]) => mock_deleteStoredFiles(...a),
}));

beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'Date',
      'performance', 'hrtime', 'requestAnimationFrame', 'cancelAnimationFrame'],
  });
  mock_deleteStoredFiles.mockClear();
});
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('the file waits for Undo', () => {
  it('outlasts the toast that offers Undo', () => {
    expect(PHOTO_UNDO_MS).toBeGreaterThan(TOAST_ACTION_MS);
  });

  it('is deleted once Undo can no longer want it, and not before', () => {
    deleteFileLater('h/a.jpg');
    jest.advanceTimersByTime(TOAST_ACTION_MS);
    expect(mock_deleteStoredFiles).not.toHaveBeenCalled();

    jest.advanceTimersByTime(PHOTO_UNDO_MS - TOAST_ACTION_MS);
    expect(mock_deleteStoredFiles).toHaveBeenCalledWith(['h/a.jpg']);
  });

  it('is kept when Undo is pressed', () => {
    deleteFileLater('h/a.jpg');
    jest.advanceTimersByTime(TOAST_ACTION_MS - 1);
    keepFile('h/a.jpg');
    jest.advanceTimersByTime(PHOTO_UNDO_MS * 2);
    expect(mock_deleteStoredFiles).not.toHaveBeenCalled();
  });

  it('calls off only the photo Undo was for', () => {
    deleteFileLater('h/a.jpg');
    deleteFileLater('h/b.jpg');
    keepFile('h/a.jpg');
    jest.advanceTimersByTime(PHOTO_UNDO_MS);
    expect(mock_deleteStoredFiles).toHaveBeenCalledTimes(1);
    expect(mock_deleteStoredFiles).toHaveBeenCalledWith(['h/b.jpg']);
  });

  // Removed, put back, removed again: one delete, timed from the last removal.
  it('is deleted once, however many times it was asked for', () => {
    deleteFileLater('h/a.jpg');
    jest.advanceTimersByTime(PHOTO_UNDO_MS - 1);
    deleteFileLater('h/a.jpg');
    jest.advanceTimersByTime(PHOTO_UNDO_MS - 1);
    expect(mock_deleteStoredFiles).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(mock_deleteStoredFiles).toHaveBeenCalledTimes(1);
  });

  it('does nothing when nothing was waiting', () => {
    expect(() => keepFile('h/never.jpg')).not.toThrow();
  });
});

describe('the strip', () => {
  it('takes one photo out and leaves the rest in order', () => {
    expect(withoutPhoto(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
    expect(withoutPhoto(['a'], 'z')).toEqual(['a']);
  });

  it('puts one back where it was', () => {
    expect(withPhotoBack(['a', 'c'], 'b', 1)).toEqual(['a', 'b', 'c']);
    expect(withPhotoBack(['b', 'c'], 'a', 0)).toEqual(['a', 'b', 'c']);
  });

  // The other phone may have taken some off since.
  it('puts it at the end when the strip has grown shorter than where it was', () => {
    expect(withPhotoBack(['a'], 'c', 2)).toEqual(['a', 'c']);
  });

  it('never adds a photo twice', () => {
    expect(withPhotoBack(['a', 'b'], 'b', 0)).toEqual(['a', 'b']);
  });
});
