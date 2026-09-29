import React from 'react';
import { AccessibilityInfo } from 'react-native';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import WelcomeFlow, { GREETINGS } from './WelcomeFlow';

// Before there is an account: hello, then one question to a screen. It took
// over the old AuthScreen's cases when that one form became three pages, and
// they are all still here, walked page by page: that the screen says what
// happens next when confirmation leaves no session, that the email can be
// answered from this tab with its code, that a join code rides through the
// email's link, that no button is dead without a reason, and that nothing Auth
// answers reaches a person in a browser alert.

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mock_signIn = jest.fn();
const mock_signUp = jest.fn();
const mock_reset = jest.fn();
const mock_resend = jest.fn();
const mock_verify = jest.fn();
const mock_google = jest.fn();
let mock_googleOn = false;

jest.mock('../lib/supabase', () => ({
  signInWithEmail: (...a: unknown[]) => mock_signIn(...a),
  signUpWithEmail: (...a: unknown[]) => mock_signUp(...a),
  sendPasswordReset: (...a: unknown[]) => mock_reset(...a),
  resendSignUpEmail: (...a: unknown[]) => mock_resend(...a),
  verifySignUpCode: (...a: unknown[]) => mock_verify(...a),
}));
jest.mock('../lib/googleSignIn', () => ({
  signInWithGoogle: () => mock_google(),
  googleSignInEnabled: () => mock_googleOn,
}));

const mock_openUrl = jest.fn();
jest.mock('../lib/openUrl', () => ({ openUrl: (...a: unknown[]) => mock_openUrl(...a) }));

const mock_showAlert = jest.fn();
jest.mock('../lib/alert', () => ({ showAlert: (...a: unknown[]) => mock_showAlert(...a) }));

const TOKEN = '8f1d3c2e-0000-4000-8000-000000000000';

type R = ReturnType<typeof render>;

const settle = () => TestRenderer.act(async () => {});

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

const press = async (r: R, text: string) => {
  await TestRenderer.act(async () => {
    await pressableAround(r, text).props.onPress();
  });
  await settle();
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

/** Hello → (the choice, when Google is on) → the email page. */
async function toEmail(joinToken: string | null = null) {
  const r = await mount(<WelcomeFlow joinToken={joinToken} />);
  await press(r, 'Get started');
  if (mock_googleOn) await press(r, 'Use my email');
  return r;
}

/** On to the password page, with an address typed. */
async function toPassword(email = 'mike@example.com', joinToken: string | null = null) {
  const r = await toEmail(joinToken);
  await type(r, 'Email', email);
  await press(r, 'Continue');
  return r;
}

async function signUpAs(r: R, password: string) {
  await press(r, "I'm new here");
  await type(r, 'Password', password);
  await press(r, 'Create account');
}

const NO_SESSION = { data: { user: { id: 'u' }, session: null }, error: null };

let reduceMotion = true;

beforeEach(() => {
  jest.clearAllMocks();
  mock_googleOn = false;
  reduceMotion = true;
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(async () => reduceMotion);
  mock_signIn.mockResolvedValue({ data: {}, error: null });
  mock_signUp.mockResolvedValue(NO_SESSION);
  mock_reset.mockResolvedValue({ data: {}, error: null });
  mock_resend.mockResolvedValue({ data: {}, error: null });
  mock_verify.mockResolvedValue({ data: { session: {} }, error: null });
  mock_google.mockResolvedValue('redirecting');
});

describe('hello', () => {
  it('opens on Welcome and one button', async () => {
    const r = await mount(<WelcomeFlow />);
    expect(r.queryByText('Welcome')).not.toBeNull();
    expect(r.queryByText('Get started')).not.toBeNull();
  });

  it('turns through its greetings', async () => {
    jest.useFakeTimers();
    try {
      reduceMotion = false;
      const r = render(<WelcomeFlow />);
      await settle();
      await TestRenderer.act(async () => { jest.advanceTimersByTime(3000); });
      expect(r.queryByText(GREETINGS[1])).not.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  // A welcome that makes somebody feel unwell is not one.
  it('holds still for anybody who has asked for less motion', async () => {
    jest.useFakeTimers();
    try {
      const r = render(<WelcomeFlow />);
      await settle();
      await TestRenderer.act(async () => { jest.advanceTimersByTime(10000); });
      expect(r.queryByText('Welcome')).not.toBeNull();
      expect(r.queryByText(GREETINGS[1])).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('Google', () => {
  // Until the consent screen is opened past the Workspace, Google refuses a
  // household on a page the app cannot word. So the button waits for the flag.
  it('is not offered while it is switched off, and the choice screen is skipped', async () => {
    const r = await mount(<WelcomeFlow />);
    await press(r, 'Get started');
    expect(r.queryByText('Continue with Google')).toBeNull();
    expect(r.queryByText("What's your email?")).not.toBeNull();
  });

  it('comes first when it is on', async () => {
    mock_googleOn = true;
    const r = await mount(<WelcomeFlow />);
    await press(r, 'Get started');
    await press(r, 'Continue with Google');
    expect(mock_google).toHaveBeenCalled();
  });

  it('a Google failure is words on the screen, not a dead end', async () => {
    mock_googleOn = true;
    mock_google.mockRejectedValue(new Error('Popup closed'));
    const r = await mount(<WelcomeFlow />);
    await press(r, 'Get started');
    await press(r, 'Continue with Google');
    expect(said(r)).toMatch(/Popup closed/);
    expect(mock_showAlert).not.toHaveBeenCalled();
    expect(r.queryByText('Use my email')).not.toBeNull();
  });
});

describe('which door it opens on', () => {
  it('opens on sign in for somebody with no code', async () => {
    const r = await toPassword();
    expect(r.queryByText('Welcome back')).not.toBeNull();
    expect(r.queryByText('Sign in')).not.toBeNull();
    expect(r.queryByText("I'm new here")).not.toBeNull();
  });

  // Somebody who has just scanned a household's QR has no account — signing
  // up IS their journey — so they should not have to find the second door.
  it('opens on create account for somebody holding a join code, and says why', async () => {
    const r = await toEmail(TOKEN);
    expect(said(r)).toMatch(/asked to join a household/);
    await type(r, 'Email', 'alyssa@example.com');
    await press(r, 'Continue');
    expect(r.queryByText('Create account')).not.toBeNull();
    expect(r.queryByText('Create an account to join the household that shared this link.')).not.toBeNull();
  });
});

describe('the email page', () => {
  it('labels the box in words that stay put while typing', async () => {
    const r = await toEmail();
    expect(r.queryByText('Email')).not.toBeNull();
    expect(field(r, 'Email').props.placeholder).toBeUndefined();
    expect(field(r, 'Email').props.autoComplete).toBe('email');
  });

  // A disabled button is indistinguishable from one that did nothing.
  it('is never a dead button: it says what it still wants', async () => {
    const r = await toEmail();
    await press(r, 'Continue');
    expect(said(r)).toMatch(/Enter your email address/);
    await type(r, 'Email', 'mike');
    await press(r, 'Continue');
    expect(said(r)).toMatch(/doesn't look like an email address/);
    expect(r.queryByText("What's your email?")).not.toBeNull();
  });
});

describe('the password page', () => {
  it('labels the box and tells a password manager what it is, in both modes', async () => {
    const r = await toPassword();
    expect(r.queryByText('Password')).not.toBeNull();
    expect(field(r, 'Password').props.placeholder).toBeUndefined();
    expect(field(r, 'Password').props.autoComplete).toBe('current-password');
    await press(r, "I'm new here");
    expect(field(r, 'Password').props.autoComplete).toBe('new-password');
  });

  it('shows and hides the password', async () => {
    const r = await toPassword();
    expect(field(r, 'Password').props.secureTextEntry).toBe(true);
    const eye = r.root.findAll((n: any) => n.props?.accessibilityLabel === 'Show password'
      && typeof n.props.onPress === 'function')[0];
    await TestRenderer.act(async () => eye.props.onPress());
    expect(field(r, 'Password').props.secureTextEntry).toBe(false);
  });

  it('submits from the keyboard', async () => {
    const r = await toPassword();
    await type(r, 'Password', 'secret-enough');
    await TestRenderer.act(async () => field(r, 'Password').props.onSubmitEditing());
    expect(mock_signIn).toHaveBeenCalledWith('mike@example.com', 'secret-enough');
  });

  it('states the password rule before anybody breaks it', async () => {
    const r = await toPassword();
    expect(r.queryByText('At least 8 characters.')).toBeNull();
    await press(r, "I'm new here");
    expect(r.queryByText('At least 8 characters.')).not.toBeNull();
  });

  it('is never a dead button: it says what the form still wants', async () => {
    const r = await toPassword('mike@example.com', TOKEN);
    await type(r, 'Password', 'short');
    expect(pressableAround(r, 'Create account').props.disabled).toBeFalsy();
    await press(r, 'Create account');
    expect(r.queryByText('Use at least 8 characters.')).not.toBeNull();
    // Said once, in red — not the hint and the error one above the other.
    expect(r.queryByText('At least 8 characters.')).toBeNull();
    expect(mock_signUp).not.toHaveBeenCalled();
  });

  it('lets an account made under the old six-character rule sign in', async () => {
    const r = await toPassword();
    await type(r, 'Password', 'abcdef');
    await press(r, 'Sign in');
    expect(mock_signIn).toHaveBeenCalledWith('mike@example.com', 'abcdef');
  });

  it('words a refused sign-in on the screen, never in a browser alert', async () => {
    mock_signIn.mockResolvedValue({
      data: {}, error: { code: 'invalid_credentials', message: 'Invalid login credentials', status: 400 },
    });
    const r = await toPassword();
    await type(r, 'Password', 'wrong-one');
    await press(r, 'Sign in');
    expect(said(r)).toMatch(/email and password don't match/);
    expect(said(r)).not.toMatch(/Invalid login credentials/);
    expect(mock_showAlert).not.toHaveBeenCalled();
  });

  it('keeps the address when switching between signing in and creating', async () => {
    const r = await toPassword();
    await press(r, "I'm new here");
    expect(said(r)).toMatch(/mike@example\.com/);
    await press(r, 'I already have an account');
    expect(said(r)).toMatch(/mike@example\.com/);
  });
});

describe('creating an account', () => {
  it('says what happens next when no session comes back', async () => {
    const r = await toPassword(' mike@example.com ');
    await signUpAs(r, 'long enough');
    expect(r.queryByText('Check your email')).not.toBeNull();
    expect(said(r)).toMatch(/mike@example\.com/);
    expect(mock_signUp).toHaveBeenCalledWith('mike@example.com', 'long enough', expect.any(String));
  });

  // Without it the link lands on the Site URL, the code is gone, and a scanner
  // is shown a house to set up — the Alyssa bug by the email's door.
  it('carries a join code through the confirmation link', async () => {
    const r = await toPassword('alyssa@example.com', TOKEN);
    await type(r, 'Password', 'long enough');
    await press(r, 'Create account');
    expect(mock_signUp.mock.calls[0][2]).toMatch(new RegExp(`/join/${TOKEN}$`));
  });

  it('leaves a returned session to the auth listener', async () => {
    mock_signUp.mockResolvedValue({ data: { user: { id: 'u' }, session: { access_token: 't' } }, error: null });
    const r = await toPassword('alyssa@example.com', TOKEN);
    await type(r, 'Password', 'long enough');
    await press(r, 'Create account');
    expect(r.queryByText('Check your email')).toBeNull();
  });
});

describe('checking your email', () => {
  async function atCheckEmail(joinToken: string | null = null) {
    const r = await toPassword('mike@example.com', joinToken);
    if (!joinToken) await press(r, "I'm new here");
    await type(r, 'Password', 'long enough');
    await press(r, 'Create account');
    return r;
  }

  // The code is typed into the tab that asked, which still holds its join
  // code; the link signs in whichever browser the mail app happens to open.
  it('takes the code from the email, spaces and all', async () => {
    const r = await atCheckEmail();
    await type(r, 'Code from the email', '123 456');
    await press(r, 'Confirm');
    expect(mock_verify).toHaveBeenCalledWith('mike@example.com', '123456');
  });

  it('asks for the code again rather than sending something that is not one', async () => {
    const r = await atCheckEmail();
    await type(r, 'Code from the email', '12');
    await press(r, 'Confirm');
    expect(mock_verify).not.toHaveBeenCalled();
    expect(said(r)).toMatch(/Type the code from the email/);
    // The length is a project setting — eight here — so no number is claimed.
    expect(said(r)).not.toMatch(/\d digits/);
  });

  // Auth answers a mistyped code with `otp_expired` too, so the words cannot
  // blame the clock alone.
  it('words a refused code as mistyped or expired, and keeps the screen', async () => {
    mock_verify.mockResolvedValue({
      data: {}, error: { code: 'otp_expired', message: 'Token has expired or is invalid', status: 403 },
    });
    const r = await atCheckEmail();
    await type(r, 'Code from the email', '123456');
    await press(r, 'Confirm');
    expect(said(r)).toMatch(/doesn't match, or it has expired/);
    expect(r.queryByText('Check your email')).not.toBeNull();
  });

  it('sends it again, to the same place', async () => {
    const r = await atCheckEmail(TOKEN);
    await press(r, 'Send it again');
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
    await press(r, 'Send it again');
    expect(said(r)).toMatch(/Wait 37 seconds/);
  });

  // Auth answers sign-up for an address that already has an account exactly
  // as it answers a new one, so the way out has to be offered to everybody.
  it('offers sign in, keeping the address, for somebody who already had an account', async () => {
    const r = await atCheckEmail();
    await press(r, 'Already have an account with this address? Sign in');
    expect(r.queryByText('Sign in')).not.toBeNull();
    expect(said(r)).toMatch(/mike@example\.com/);
  });

  it('goes back for a different address', async () => {
    const r = await atCheckEmail();
    await press(r, 'Use a different address');
    expect(r.queryByText("What's your email?")).not.toBeNull();
  });

  it('is where a sign-in refused for an unconfirmed address goes', async () => {
    mock_signIn.mockResolvedValue({
      data: {}, error: { code: 'email_not_confirmed', message: 'Email not confirmed', status: 400 },
    });
    const r = await toPassword();
    await type(r, 'Password', 'long enough');
    await press(r, 'Sign in');
    expect(r.queryByText('Check your email')).not.toBeNull();
    expect(said(r)).toMatch(/hasn't been confirmed yet/);
    expect(r.queryByText('Send it again')).not.toBeNull();
  });
});

describe('forgotten password', () => {
  it('says nothing about whether the address has an account', async () => {
    const r = await toPassword();
    await press(r, 'Forgot your password?');
    expect(mock_reset).toHaveBeenCalledWith('mike@example.com');
    expect(said(r)).toMatch(/If mike@example\.com has an account/);
    expect(mock_showAlert).not.toHaveBeenCalled();
  });

  it('is not offered while creating an account', async () => {
    const r = await toPassword();
    await press(r, "I'm new here");
    expect(r.queryByText('Forgot your password?')).toBeNull();
  });
});

describe('privacy', () => {
  // Said where the details are collected, which is what the Privacy Act asks.
  it('is stated on create account, with the statement one tap away', async () => {
    const r = await toPassword('alyssa@example.com', TOKEN);
    expect(said(r)).toMatch(/Snag keeps your email address/);
    await press(r, 'Privacy statement');
    expect(mock_openUrl).toHaveBeenCalledWith('https://www.snaghq.co.nz/privacy');
  });

  it('puts the terms beside the statement', async () => {
    const r = await toPassword('alyssa@example.com', TOKEN);
    await press(r, 'Terms');
    expect(mock_openUrl).toHaveBeenCalledWith('https://www.snaghq.co.nz/terms');
  });

  it('is not repeated at every sign-in', async () => {
    const r = await toPassword();
    expect(r.queryByText('Privacy statement')).toBeNull();
  });
});
