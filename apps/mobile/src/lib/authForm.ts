/**
 * The words on the sign-in screen, decided outside it so they can be asserted.
 *
 * Two jobs. `formProblem` says what is wrong with the form *before* anything is
 * sent, so the button is never a dead control with no reason on it — a disabled
 * button is indistinguishable from one that did nothing. `describeAuthError`
 * turns what Supabase Auth answers into the app's own words, because its
 * messages are written for developers ("Invalid login credentials", "For
 * security purposes, you can only request this after 42 seconds") and used to
 * be put straight into a `window.alert`.
 */

export type AuthMode = 'signIn' | 'signUp';

/**
 * The shortest password a new account can have.
 *
 * Eight, to match `/reset-password` on the portal — the two used to disagree
 * (six here, eight there), so a password somebody chose at sign-up could not be
 * chosen again the day they reset it. **Only sign-up checks it.** Sign-in takes
 * whatever was set before, and accounts made under the old six-character rule
 * must still be able to get in. Supabase Auth's own minimum (Auth → Providers →
 * Email) is what actually enforces it; this is the words before the request.
 */
export const MIN_PASSWORD_LENGTH = 8;

/** What a new password under the minimum is told. The screen reads it too. */
export const PASSWORD_TOO_SHORT = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;

/** Loose on purpose: a typo check, not a validator. Auth decides the rest. */
export function looksLikeEmail(text: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text.trim());
}

/** What stops this form being sent, in words — or null when it can go. */
export function formProblem(mode: AuthMode, email: string, password: string): string | null {
  if (!email.trim()) return 'Enter your email address.';
  if (!looksLikeEmail(email)) return "That doesn't look like an email address.";
  if (!password) return mode === 'signUp' ? 'Choose a password.' : 'Enter your password.';
  if (mode === 'signUp' && password.length < MIN_PASSWORD_LENGTH) {
    return PASSWORD_TOO_SHORT;
  }
  return null;
}

/**
 * The code from a confirmation email, or null. Supabase sends six digits by
 * default and can be set to send up to ten; a code pasted from a mail app
 * arrives with spaces in it.
 */
export function parseEmailCode(text: string): string | null {
  const digits = text.replace(/\s+/g, '');
  return /^\d{6,10}$/.test(digits) ? digits : null;
}

/** The shape every auth-js error has; kept loose so a plain Error fits too. */
export interface AuthErrorLike {
  message?: string;
  code?: string;
  status?: number;
  name?: string;
  reasons?: string[];
}

/** The account exists and the password was right; the address isn't confirmed. */
export function isEmailNotConfirmed(error: AuthErrorLike | null | undefined): boolean {
  if (!error) return false;
  return error.code === 'email_not_confirmed' || /email not confirmed/i.test(error.message ?? '');
}

function secondsToWait(message: string): number | null {
  const match = /after (\d+) seconds?/i.exec(message);
  return match ? Number(match[1]) : null;
}

/**
 * Supabase Auth's answer, in the words somebody holding a phone would use.
 *
 * Deliberately never says whether an address has an account. Sign-in answers
 * "email or password" for both halves, which is what Auth itself returns, and
 * sign-up for an address already registered is handled by the screen rather
 * than here — see AuthScreen's check-your-email state.
 */
export function describeAuthError(error: AuthErrorLike | null | undefined): string {
  if (!error) return 'Something went wrong. Please try again.';
  const message = error.message ?? '';

  // No answer at all: a dead connection, or fetchWithTimeout giving up. The
  // browser reports a CSP block the same way, which the app can't tell apart.
  if (
    error.name === 'AuthRetryableFetchError'
    || error.name === 'AbortError'
    || error.status === 0
    || /failed to fetch|network request failed|aborted/i.test(message)
  ) {
    return "Couldn't reach Snag. Check your connection and try again.";
  }

  switch (error.code) {
    case 'invalid_credentials':
      return "That email and password don't match. Check both, or reset your password.";
    case 'email_not_confirmed':
      return 'Confirm your email address first — the link and code are in the email we sent.';
    case 'user_already_exists':
    case 'email_exists':
      return 'There is already an account for this address. Sign in instead.';
    case 'email_address_invalid':
      return "That doesn't look like an email address.";
    case 'weak_password':
      if (error.reasons?.includes('pwned')) {
        return 'That password has turned up in a data breach somewhere else. Choose another.';
      }
      return `Choose a longer password — at least ${MIN_PASSWORD_LENGTH} characters.`;
    case 'otp_expired':
      return 'That code has expired or was already used. Send a new one.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit': {
      const wait = secondsToWait(message);
      return wait
        ? `Too many tries. Wait ${wait} seconds, then try again.`
        : 'Too many tries. Wait a minute, then try again.';
    }
    case 'signup_disabled':
      return "New accounts can't be made right now.";
    case 'captcha_failed':
      return "Couldn't check you're a person. Please try again.";
    case 'request_timeout':
      return "Couldn't reach Snag. Check your connection and try again.";
  }

  // Older servers send no code; match what they say.
  if (/invalid login credentials/i.test(message)) {
    return "That email and password don't match. Check both, or reset your password.";
  }
  if (/already registered/i.test(message)) {
    return 'There is already an account for this address. Sign in instead.';
  }
  const wait = secondsToWait(message);
  if (wait) return `Too many tries. Wait ${wait} seconds, then try again.`;
  if (/rate limit/i.test(message)) return 'Too many tries. Wait a minute, then try again.';

  // Anything else is said as Auth said it: hiding an unfamiliar reason leaves
  // nobody able to report what actually happened.
  return message || 'Something went wrong. Please try again.';
}
