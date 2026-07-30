import { Alert, Platform } from 'react-native';
import { showAlert } from './alert';

// react-native-web's Alert is a no-op stub, so on the web build every dialog in
// this app did nothing — and any action behind a confirmation (Sign Out,
// deactivate an org, delete a work group) was dead. What matters here is that
// the chosen action actually runs on both platforms, and that a cancel doesn't.

jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() },
  Platform: { OS: 'ios' },
}));

const setPlatform = (os: string) => {
  (Platform as unknown as { OS: string }).OS = os;
};

const confirmSpy = jest.fn();
const alertSpy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  setPlatform('ios');
  (global as unknown as { window: unknown }).window = { confirm: confirmSpy, alert: alertSpy };
});

describe('showAlert on native', () => {
  it('hands straight to Alert.alert', () => {
    const buttons = [{ text: 'Cancel', style: 'cancel' as const }, { text: 'Sign Out', onPress: jest.fn() }];
    showAlert('Sign Out', 'Are you sure?', buttons);
    expect(Alert.alert).toHaveBeenCalledWith('Sign Out', 'Are you sure?', buttons);
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

describe('showAlert on web', () => {
  beforeEach(() => setPlatform('web'));

  it('runs the action when a confirmation is accepted', () => {
    const onPress = jest.fn();
    confirmSpy.mockReturnValue(true);

    showAlert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress },
    ]);

    expect(confirmSpy).toHaveBeenCalledWith('Sign Out\n\nAre you sure you want to sign out?');
    expect(onPress).toHaveBeenCalledTimes(1);
    // The bug this replaces: Alert.alert on web is a stub, so this never ran.
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('does not run the action when the confirmation is dismissed', () => {
    const onPress = jest.fn();
    const onCancel = jest.fn();
    confirmSpy.mockReturnValue(false);

    showAlert('Delete work group?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel', onPress: onCancel },
      { text: 'Delete', style: 'destructive', onPress },
    ]);

    expect(onPress).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows a message-only alert without asking anything', () => {
    showAlert('Error', 'Could not update organisation status');

    expect(alertSpy).toHaveBeenCalledWith('Error\n\nCould not update organisation status');
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('shows a title-only alert', () => {
    showAlert('Description required');
    expect(alertSpy).toHaveBeenCalledWith('Description required');
  });

  it('still runs the single button of an acknowledgement dialog', () => {
    const onPress = jest.fn();
    confirmSpy.mockReturnValue(true);
    showAlert('Submitted', 'Thanks.', [{ text: 'OK', onPress }]);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('warns rather than silently dropping a choice it cannot offer', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const first = jest.fn();
    const second = jest.fn();
    confirmSpy.mockReturnValue(true);

    showAlert('Add a photo', undefined, [
      { text: 'Take Photo', onPress: first },
      { text: 'Choose from Library', onPress: second },
      { text: 'Cancel', style: 'cancel' },
    ]);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("2 actions can't be offered"));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
