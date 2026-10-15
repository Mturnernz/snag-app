import { NOTE_UNDO_MS, deleteNoteLater, keepNote } from './noteEdits';
import { TOAST_ACTION_MS } from '../hooks/useToast';

const mock_deleteComment = jest.fn();
jest.mock('./supabase', () => ({ deleteComment: (...a: unknown[]) => mock_deleteComment(...a) }));

// A deleted note is gone for good, and writing it again would give it a new
// time and start the job — so the delete waits until Undo cannot want it.

beforeEach(() => {
  jest.useFakeTimers();
  mock_deleteComment.mockReset().mockResolvedValue(undefined);
});
afterEach(() => jest.useRealTimers());

it('outlasts the toast that offers Undo', () => {
  expect(NOTE_UNDO_MS).toBeGreaterThan(TOAST_ACTION_MS);
});

it('deletes only once the wait is over', async () => {
  const done = deleteNoteLater('n1');
  jest.advanceTimersByTime(NOTE_UNDO_MS - 1);
  expect(mock_deleteComment).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  expect(mock_deleteComment).toHaveBeenCalledWith('n1');
  await expect(done).resolves.toBe(true);
});

it('never deletes a note somebody undid', () => {
  void deleteNoteLater('n2');
  keepNote('n2');
  jest.advanceTimersByTime(NOTE_UNDO_MS * 2);
  expect(mock_deleteComment).not.toHaveBeenCalled();
});

it('says when the server refused', async () => {
  mock_deleteComment.mockRejectedValue(new Error('Only the person who wrote a note can delete it'));
  const done = deleteNoteLater('n3');
  jest.advanceTimersByTime(NOTE_UNDO_MS);
  await expect(done).resolves.toBe(false);
});
