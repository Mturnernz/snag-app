import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import AuthScreen from './AuthScreen';

// The front door, and the part of it that used to say nothing. Email
// confirmation is on, so creating an account answers with no session and no
// error — and the screen stopped its spinner and left somebody looking at the
// form they had just filled in. What these pin: that it says what happens next,
// that the email can be answered from this tab with its code, that a join code
// rides through the email's link, that the button is never dead without a
// reason, and that nothing Auth answers reaches a person in a browser alert.

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mock_signIn = jest.fn();
const mock_signUp = jest.fn();
const mock_reset = jest.fn();
const mock_resend = jest.fn();
const mock_verify = jest.fn();

jest.mock('../lib/supabase', () => ({
  signInWithEmail: (...a: unknown[]) => mock_signIn(...a),
  signUpWithEmail: (...a: unknown[]) => mock_signUp(...a),
  sendPasswordReset: (...a: unknown[]) => mock_reset(...a),
  resendSignUpEmail: (...a: unknown[]) => mock_resend(...a),
  verifySignUpCode: (...a: unknown[]) => mock_verify(...a),
}));

const mock_openUrl = jest.fn();
jest.mock('../lib/openUrl', () => ({ openUrl: (...a: unknown[]) => mock_openUrl(...a) }));

const mock_showAlert = jest.fn();
jest.mock('../lib/alert', () => ({ showAlert: (...a: unknown[]) => mock_showAlert(...a) }));

const TOKEN = '8f1d3c2e-0000-4000-8000-000000000000';

type R = ReturnType<typeof render>;

const settle = () => TestRenderer.act(async () => {});

// Settled once, so the icon font finishing its load lands inside act.
const mount = async (element: React.ReactElement) => {
  const r = render(element);
  await settle();
  return r;
};

const pressableAround = (r: R, text: string) => {
  let node: any = r.getByText(text);
  while (node) {
    if (typeof node.props?.onPress === 'function') return node;
    node = node.parent;
  }
  throw new Error(`Nothing pressable around "${text}"`);
};

const press = async (node: any) => {
  await TestRenderer.act(async () => {
    await node.props.onPress();
  });
};

const field = (r: R, label: string) => {
  const found = r.root.findAll(
    (n: any) => typeof n.type === 'string' && n.type === 'TextInput' && n.props.accessibilityLabel === label,
  );
  if (!found.length) throw new Error(`No field labelled "${label}"`);
  return found[0];
};

const type = async (r: R, label: string, text: string) => {
  await TestRenderer.act(async () => field(r, label).props.onChangeText(text));
};

const said = (r: R) => r.root
  .findAll((n: any) => typeof n.type === 'string' && n.type === 'Text')
  .map((n: any) => JSON.stringify(n.children))
  .join(' ');

async function fillIn(r: R, email: string, password: string) {
  await type(r, 'Email', email);
  await type(r, 'Password', password);
}

const NO_SESSION = { data: { user: { id: 'u' }, session: null }, error: null };

beforeEach(() => {
  jest.clearAllMocks();
  mock_signIn.mockResolvedValue({ data: {}, error: null });
  mock_signUp.mockResolvedValue(NO_SESSION);
  mock_reset.mockResolvedValue({ data: {}, error: null });
  mock_resend.mockResolvedValue({ data: {}, error: null });
  mock_verify.mockResolvedValue({ data: { session: {} }, error: null });
});

describe('which door it opens on', () => {
  it('opens on sign in for somebody with no code', async () => {
    const r = await mount(<AuthScreen />);
    expect(r.queryByText('Sign in')).not.toBeNull();
    expect(r.queryByText('No account yet? Create one')).not.toBeNull();
  });

  // Somebody who has just scanned a household's QR has no account — signing
  // up IS their journey — so they should not have to find the second door.
  it('opens on create account for somebody holding a join code, and says why', async () => {
    const r = await mount(<AuthScreen joinToken={TOKEN} />);
    expect(r.queryByText('Create account')).not.toBeNull();
    expect(r.queryByText('Create an account to join the household that shared this link.')).not.toBeNull();
  });
});

describe('the form', () => {
  it('labels each box in words that stay put while typing', async () => {
    const r = await mount(<AuthScreen />);
    expect(r.queryByText('Email')).not.toBeNull();
    expect(r.queryByText('Password')).not.toBeNull();
    expect(field(r, 'Email').props.placeholder).toBeUndefined();
    expect(field(r, 'Password').props.placeholder).toBeUndefined();
  });

  // textContentType is iOS-native only; the web build is what people install,
  // and autoComplete is what reaches its password managers.
  it('tells a password manager what each box is, in both modes', async () => {
    const r = await mount(<AuthScreen />);
    expect(field(r, 'Email').props.autoComplete).toBe('email');
    expect(field(r, 'Password').props.autoComplete).toBe('current-password');

    await press(pressableAround(r, 'No account yet? Create one'));
    expect(field(r, 'Password').props.autoComplete).toBe('new-password');
  });

  it('shows and hides the password', async () => {
    const r = await mount(<AuthScreen />);
    expect(field(r, 'Password').props.secureTextEntry).toBe(true);
    const eye = r.root.findAll((n: any) => n.props?.accessibilityLabel === 'Show password'
      && typeof n.props.onPress === 'function')[0];
    await press(eye);
    expect(field(r, 'Password').props.secureTextEntry).toBe(false);
  });

  it('submits from the keyboard', async () => {
    const r = await mount(<AuthScreen />);
    await fillIn(r, 'mike@example.com', 'secret-enough');
    await TestRenderer.act(async () => field(r, 'Password').props.onSubmitEditing());
    expect(mock_signIn).toHaveBeenCalledWith('mike@example.com', 'secret-enough');
  });

  it('states the password rule before anybody breaks it', async () => {
    const r = await mount(<AuthScreen />);
    expect(r.queryByText('At least 8 characters.')).toBeNull();
    await press(pressableAround(r, 'No account yet? Create one'));
    expect(r.queryByText('At least 8 characters.')).not.toBeNull();
  });

  // A disabled button is indistinguishable from one that did nothing.
  it('is never a dead button: it says what the form still wants', async () => {
    const r = await mount(<AuthScreen joinToken={TOKEN} />);
    await fillIn(r, 'mike@example.com', 'short');
    const button = pressableAround(r, 'Create account');
    expect(button.props.disabled).toBeFalsy();

    await press(button);
    expect(r.queryByText('Use at least 8 characters.')).not.toBeNull();
    // Said once, in red — not the hint and the error one above the other.
    expect(r.queryByText('At least 8 characters.')).toBeNull();
    expect(mock_signUp).not.toHaveBeenCalled();
  });

  it('lets an account made under the old six-character rule sign in', async () => {
    const r = await mount(<AuthScreen />);
    await fillIn(r, 'mike@example.com', 'abcdef');
    await press(pressableAround(r, 'Sign in'));
    expect(mock_signIn).toHaveBeenCalledWith('mike@example.com', 'abcdef');
  });

  it('words a refused sign-in on the screen, never in a browser alert', async () => {
    mock_signIn.mockResolvedValue({
      data: {}, error: { code: 'invalid_credentials', message: 'Invalid login credentials', status: 400 },
    });
    const r = await mount(<AuthScreen />);
    await fillIn(r, 'mike@example.com', 'wrong-one');
    await press(pressableAround(r, 'Sign in'));

    expect(said(r)).toMatch(/email and password don't match/);
    expect(said(r)).not.toMatch(/Invalid login credentials/);
    expect(mock_showAlert).not.toHaveBeenCalled();
  });
});

describe('creating an account', () => {
  it('says what happens next when no session comes back', async () => {
    const r = await mount(<AuthScreen />);
    await press(pressableAround(r, 'No account yet? Create one'));
    await fillIn(r, ' mike@example.com ', 'long enough');
    await press(pressableAround(r, 'Create account'));

    expect(r.queryByText('Check your email')).not.toBeNull();
    expect(said(r)).toMatch(/mike@example\.com/);
    expect(mock_signUp).toHaveBeenCalledWith('mike@example.com', 'long enough', expect.any(String));
  });

  // Without it the link lands on the Site URL, the code is gone, and a scanner
  // is shown *Set up your house* — the Alyssa bug by the email's door.
  it('carries a join code through the confirmation link', async () => {
    const r = await mount(<AuthScreen joinToken={TOKEN} />);
    await fillIn(r, 'alyssa@example.com', 'long enough');
    await press(pressableAround(r, 'Create account'));

    expect(mock_signUp.mock.calls[0][2]).toMatch(new RegExp(`/join/${TOKEN}$`));
  });

  it('leaves a returned session to the auth listener', async () => {
    mock_signUp.mockResolvedValue({ data: { user: { id: 'u' }, session: { access_token: 't' } }, error: null });
    const r = await mount(<AuthScreen joinToken={TOKEN} />);
    await fillIn(r, 'alyssa@example.com', 'long enough');
    await press(pressableAround(r, 'Create account'));

    expect(r.queryByText('Check your email')).toBeNull();
  });
});

describe('checking your email', () => {
  async function atCheckEmail(joinToken: string | null = null) {
    const r = await mount(<AuthScreen joinToken={joinToken} />);
    if (!joinToken) await press(pressableAround(r, 'No account yet? Create one'));
    await fillIn(r, 'mike@example.com', 'long enough');
    await press(pressableAround(r, 'Create account'));
    await settle();
    return r;
  }

  // The code is typed into the tab that asked, which still holds its join
  // code; the link signs in whichever browser the mail app happens to open.
  it('takes the code from the email, spaces and all', async () => {
    const r = await atCheckEmail();
    await type(r, 'Code from the email', '123 456');
    await press(pressableAround(r, 'Confirm'));
    expect(mock_verify).toHaveBeenCalledWith('mike@example.com', '123456');
  });

  it('asks for the code again rather than sending something that is not one', async () => {
    const r = await atCheckEmail();
    await type(r, 'Code from the email', '12');
    await press(pressableAround(r, 'Confirm'));
    expect(mock_verify).not.toHaveBeenCalled();
    expect(said(r)).toMatch(/6 digits/);
  });

  it('words a spent code and keeps the screen', async () => {
    mock_verify.mockResolvedValue({
      data: {}, error: { code: 'otp_expired', message: 'Token has expired or is invalid', status: 403 },
    });
    const r = await atCheckEmail();
    await type(r, 'Code from the email', '123456');
    await press(pressableAround(r, 'Confirm'));
    expect(said(r)).toMatch(/expired or was already used/);
    expect(r.queryByText('Check your email')).not.toBeNull();
  });

  it('sends it again, to the same place', async () => {
    const r = await atCheckEmail(TOKEN);
    await press(pressableAround(r, 'Send it again'));
    expect(mock_resend).toHaveBeenCalledWith('mike@example.com', expect.stringMatching(`/join/${TOKEN}$`));
    expect(said(r)).toMatch(/Sent again to mike@example\.com/);
  });

  it('turns a resend rate limit into how long to wait', async () => {
    mock_resend.mockResolvedValue({
      data: {},
      error: {
        code: 'over_email_send_rate_limit',
        message: 'For security purposes, you can only request this after 37 seconds.',
        status: 429,
      },
    });
    const r = await atCheckEmail();
    await press(pressableAround(r, 'Send it again'));
    expect(said(r)).toMatch(/Wait 37 seconds/);
  });

  // Auth answers sign-up for an address that already has an account exactly
  // as it answers a new one, so the way out has to be offered to everybody.
  it('offers sign in, keeping the address, for somebody who already had an account', async () => {
    const r = await atCheckEmail();
    await press(pressableAround(r, 'Already have an account with this address? Sign in'));
    expect(r.queryByText('Sign in')).not.toBeNull();
    expect(field(r, 'Email').props.value).toBe('mike@example.com');
  });

  it('is where a sign-in refused for an unconfirmed address goes', async () => {
    mock_signIn.mockResolvedValue({
      data: {}, error: { code: 'email_not_confirmed', message: 'Email not confirmed', status: 400 },
    });
    const r = await mount(<AuthScreen />);
    await fillIn(r, 'mike@example.com', 'long enough');
    await press(pressableAround(r, 'Sign in'));

    expect(r.queryByText('Check your email')).not.toBeNull();
    expect(said(r)).toMatch(/hasn't been confirmed yet/);
    expect(r.queryByText('Send it again')).not.toBeNull();
  });
});

describe('forgotten password', () => {
  it('asks for the address first, on the screen', async () => {
    const r = await mount(<AuthScreen />);
    await press(pressableAround(r, 'Forgot your password?'));
    expect(said(r)).toMatch(/Enter your email address first/);
    expect(mock_reset).not.toHaveBeenCalled();
  });

  it('says nothing about whether the address has an account', async () => {
    const r = await mount(<AuthScreen />);
    await type(r, 'Email', 'mike@example.com');
    await press(pressableAround(r, 'Forgot your password?'));
    expect(mock_reset).toHaveBeenCalledWith('mike@example.com');
    expect(said(r)).toMatch(/If mike@example\.com has an account/);
  });
});

describe('privacy', () => {
  // Said where the details are collected, which is what the Privacy Act asks.
  it('is stated on create account, with the statement one tap away', async () => {
    const r = await mount(<AuthScreen joinToken={TOKEN} />);
    expect(said(r)).toMatch(/Snag keeps your email address/);
    await press(pressableAround(r, 'Privacy statement'));
    expect(mock_openUrl).toHaveBeenCalledWith('https://www.snaghq.co.nz/privacy');
  });

  it('is not repeated at every sign-in', async () => {
    const r = await mount(<AuthScreen />);
    expect(r.queryByText('Privacy statement')).toBeNull();
  });
});
