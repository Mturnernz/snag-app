import React from 'react';
import { AccessibilityInfo } from 'react-native';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import WelcomeFlow, { GREETINGS } from './WelcomeFlow';

// Before there is an account: hello, then one question to a screen. What is
// pinned is the order, the two ways in, and that somebody who has asked for
// less motion gets a greeting that holds still.

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mock = {
  signInWithGoogle: jest.fn(),
  signInWithEmail: jest.fn(),
  signUpWithEmail: jest.fn(),
  sendPasswordReset: jest.fn(),
  showAlert: jest.fn(),
};

jest.mock('../lib/supabase', () => ({
  signInWithEmail: (...a: unknown[]) => mock.signInWithEmail(...a),
  signUpWithEmail: (...a: unknown[]) => mock.signUpWithEmail(...a),
  sendPasswordReset: (...a: unknown[]) => mock.sendPasswordReset(...a),
}));
jest.mock('../lib/googleSignIn', () => ({ signInWithGoogle: () => mock.signInWithGoogle() }));
jest.mock('../lib/alert', () => ({ showAlert: (...a: unknown[]) => mock.showAlert(...a) }));

const settle = () => TestRenderer.act(async () => {});

const pressableAround = (r: ReturnType<typeof render>, text: string) => {
  let node: any = r.getByText(text);
  while (node) {
    if (typeof node.props?.onPress === 'function') return node;
    node = node.parent;
  }
  throw new Error(`Nothing pressable around "${text}"`);
};

const press = async (r: ReturnType<typeof render>, text: string) => {
  await TestRenderer.act(async () => {
    await pressableAround(r, text).props.onPress();
  });
  await settle();
};

const type = async (r: ReturnType<typeof render>, label: string, text: string) => {
  const node = r.root.findAll(
    (n: any) => typeof n.type === 'string' && n.props?.accessibilityLabel === label
  )[0];
  await TestRenderer.act(async () => node.props.onChangeText(text));
};

let reduceMotion = true;

beforeEach(() => {
  jest.clearAllMocks();
  reduceMotion = true;
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(async () => reduceMotion);
  mock.signInWithGoogle.mockResolvedValue('redirecting');
  mock.signInWithEmail.mockResolvedValue({ error: null });
  mock.signUpWithEmail.mockResolvedValue({ data: { session: {} }, error: null });
  mock.sendPasswordReset.mockResolvedValue({ error: null });
});

async function toEmail() {
  const r = render(<WelcomeFlow />);
  await settle();
  await press(r, 'Get started');
  await press(r, 'Use my email');
  await type(r, 'Email', 'alyssa@example.nz');
  await press(r, 'Continue');
  return r;
}

describe('hello', () => {
  it('opens on Kia ora and one button', async () => {
    const r = render(<WelcomeFlow />);
    await settle();
    expect(r.queryByText('Kia ora')).not.toBeNull();
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
      expect(r.queryByText('Kia ora')).not.toBeNull();
      expect(r.queryByText(GREETINGS[1])).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('signing in', () => {
  it('offers Google first', async () => {
    const r = render(<WelcomeFlow />);
    await settle();
    await press(r, 'Get started');
    await press(r, 'Continue with Google');
    expect(mock.signInWithGoogle).toHaveBeenCalled();
  });

  it('a Google failure is one sentence, not a dead end', async () => {
    mock.signInWithGoogle.mockRejectedValue(new Error('Popup closed'));
    const r = render(<WelcomeFlow />);
    await settle();
    await press(r, 'Get started');
    await press(r, 'Continue with Google');
    expect(mock.showAlert).toHaveBeenCalledWith("Couldn't sign in with Google", 'Popup closed');
    expect(r.queryByText('Continue with Google')).not.toBeNull();
  });

  it('an email and a password sign in', async () => {
    const r = await toEmail();
    expect(r.queryByText('Welcome back')).not.toBeNull();
    await type(r, 'Password', 'hunter22');
    await press(r, 'Sign in');
    expect(mock.signInWithEmail).toHaveBeenCalledWith('alyssa@example.nz', 'hunter22');
  });

  it("I'm new here makes an account instead", async () => {
    const r = await toEmail();
    await press(r, "I'm new here");
    expect(r.queryByText('Nice to meet you')).not.toBeNull();
    await type(r, 'Password', 'hunter22');
    await press(r, 'Create account');
    expect(mock.signUpWithEmail).toHaveBeenCalledWith('alyssa@example.nz', 'hunter22');
    expect(mock.signInWithEmail).not.toHaveBeenCalled();
  });

  it('says to check the email when the project wants the address confirmed', async () => {
    mock.signUpWithEmail.mockResolvedValue({ data: { session: null }, error: null });
    const r = await toEmail();
    await press(r, "I'm new here");
    await type(r, 'Password', 'hunter22');
    await press(r, 'Create account');
    expect(mock.showAlert).toHaveBeenCalledWith('Check your email', expect.stringContaining('alyssa@example.nz'));
  });

  it('a forgotten password sends a reset link to the address already typed', async () => {
    const r = await toEmail();
    await press(r, 'Forgot your password?');
    expect(mock.sendPasswordReset).toHaveBeenCalledWith('alyssa@example.nz');
  });
});
