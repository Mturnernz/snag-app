import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import ChangePasswordSheet from './ChangePasswordSheet';

const mock_updatePassword = jest.fn();
jest.mock('../lib/supabase', () => ({ updatePassword: (...a: unknown[]) => mock_updatePassword(...a) }));

// The password, changed from the You tab rather than by a reset email. The
// sign-up page's rules, and every refusal in words on the sheet.

const box = (r: ReturnType<typeof render>, label: string) =>
  r.root.findAll((n: any) => n.props?.accessibilityLabel === label && n.props?.onChangeText)[0];
const button = (r: ReturnType<typeof render>) =>
  r.root.findAll((n: any) => typeof n.type !== 'string' && n.props?.label === 'Change password' && n.props?.onPress)[0];

async function fill(r: ReturnType<typeof render>, one: string, two: string) {
  await TestRenderer.act(async () => { box(r, 'New password').props.onChangeText(one); });
  await TestRenderer.act(async () => { box(r, 'The new password again').props.onChangeText(two); });
  await TestRenderer.act(async () => { await button(r).props.onPress(); });
}

beforeEach(() => mock_updatePassword.mockReset().mockResolvedValue({ error: null }));

it('changes it, then closes and says so', async () => {
  const onChanged = jest.fn();
  const onClose = jest.fn();
  const r = render(<ChangePasswordSheet visible onClose={onClose} onChanged={onChanged} />);
  await fill(r, 'kowhai-street', 'kowhai-street');
  expect(mock_updatePassword).toHaveBeenCalledWith('kowhai-street');
  expect(onChanged).toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});

it('asks for eight characters, as sign-up does', async () => {
  const r = render(<ChangePasswordSheet visible onClose={jest.fn()} onChanged={jest.fn()} />);
  await fill(r, 'short', 'short');
  expect(mock_updatePassword).not.toHaveBeenCalled();
  expect(r.queryByText('Use at least 8 characters.')).not.toBeNull();
});

it('refuses two that do not match', async () => {
  const r = render(<ChangePasswordSheet visible onClose={jest.fn()} onChanged={jest.fn()} />);
  await fill(r, 'kowhai-street', 'kowhai-stret');
  expect(mock_updatePassword).not.toHaveBeenCalled();
  expect(r.queryByText("The two don't match.")).not.toBeNull();
});

it("words Auth's own refusal on the sheet, and stays open", async () => {
  mock_updatePassword.mockResolvedValue({ error: { code: 'weak_password', message: 'Password is known to be weak' } });
  const onClose = jest.fn();
  const r = render(<ChangePasswordSheet visible onClose={onClose} onChanged={jest.fn()} />);
  await fill(r, 'password123', 'password123');
  expect(onClose).not.toHaveBeenCalled();
  expect(r.root.findAll((n: any) => n.props?.accessibilityRole === 'alert').length).toBeGreaterThan(0);
});
