import {
  MIN_PASSWORD_LENGTH, describeAuthError, formProblem, isEmailNotConfirmed, looksLikeEmail,
  parseEmailCode,
} from './authForm';

// The sign-in screen's words, decided outside it. What these pin: that the form
// says what it wants rather than sitting behind a dead button, that the password
// rule applies to new accounts only, and that nothing Supabase Auth answers
// reaches a person in its developer wording.

describe('formProblem', () => {
  it('asks for the address first', () => {
    expect(formProblem('signIn', '  ', 'whatever')).toBe('Enter your email address.');
  });

  it('catches an address with no domain', () => {
    expect(formProblem('signUp', 'mike@home', 'long enough')).toMatch(/doesn't look like an email/);
  });

  it('asks for a password in the words of each mode', () => {
    expect(formProblem('signIn', 'a@b.co', '')).toBe('Enter your password.');
    expect(formProblem('signUp', 'a@b.co', '')).toBe('Choose a password.');
  });

  it(`wants ${MIN_PASSWORD_LENGTH} characters of a new password`, () => {
    expect(formProblem('signUp', 'a@b.co', 'x'.repeat(MIN_PASSWORD_LENGTH - 1)))
      .toBe(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    expect(formProblem('signUp', 'a@b.co', 'x'.repeat(MIN_PASSWORD_LENGTH))).toBeNull();
  });

  // Accounts made under the old six-character rule must still get in.
  it('never applies the length rule to signing in', () => {
    expect(formProblem('signIn', 'a@b.co', 'abcdef')).toBeNull();
  });

  it('matches the reset page, which has always wanted eight', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
  });
});

describe('looksLikeEmail', () => {
  it('is a typo check, not a validator', () => {
    expect(looksLikeEmail(' mike@example.co.nz ')).toBe(true);
    expect(looksLikeEmail('mike@example')).toBe(false);
    expect(looksLikeEmail('mike example.com')).toBe(false);
  });
});

describe('parseEmailCode', () => {
  it('reads six digits, with the spaces a mail app puts in', () => {
    expect(parseEmailCode('123 456')).toBe('123456');
    expect(parseEmailCode(' 123456\n')).toBe('123456');
  });

  it('allows the longer codes Auth can be set to send', () => {
    expect(parseEmailCode('1234567890')).toBe('1234567890');
  });

  it('refuses anything that is not a code', () => {
    expect(parseEmailCode('12345')).toBeNull();
    expect(parseEmailCode('12a456')).toBeNull();
    expect(parseEmailCode('')).toBeNull();
  });
});

describe('isEmailNotConfirmed', () => {
  it('reads the code, and the message from a server that sends none', () => {
    expect(isEmailNotConfirmed({ code: 'email_not_confirmed', message: 'x' })).toBe(true);
    expect(isEmailNotConfirmed({ message: 'Email not confirmed' })).toBe(true);
    expect(isEmailNotConfirmed({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe(false);
    expect(isEmailNotConfirmed(null)).toBe(false);
  });
});

describe('describeAuthError', () => {
  it('never says which half of a sign-in was wrong', () => {
    const said = describeAuthError({ code: 'invalid_credentials', message: 'Invalid login credentials' });
    expect(said).toMatch(/email and password don't match/);
    expect(said).not.toMatch(/Invalid login credentials/);
  });

  it('words a server that sends no code the same way', () => {
    expect(describeAuthError({ message: 'Invalid login credentials' })).toMatch(/don't match/);
  });

  it('turns a rate limit into how long to wait', () => {
    expect(describeAuthError({
      code: 'over_email_send_rate_limit',
      message: 'For security purposes, you can only request this after 42 seconds.',
    })).toBe('Too many tries. Wait 42 seconds, then try again.');
    expect(describeAuthError({ code: 'over_request_rate_limit', message: 'Request rate limit reached' }))
      .toBe('Too many tries. Wait a minute, then try again.');
  });

  it('says a breached password is breached, rather than "weak"', () => {
    expect(describeAuthError({ code: 'weak_password', message: 'weak', reasons: ['pwned'] }))
      .toMatch(/data breach/);
    expect(describeAuthError({ code: 'weak_password', message: 'weak', reasons: ['length'] }))
      .toMatch(/at least 8 characters/);
  });

  it('says a spent code is spent, and how to get another', () => {
    expect(describeAuthError({ code: 'otp_expired', message: 'Token has expired or is invalid' }))
      .toMatch(/Send a new one/);
  });

  it('words no answer at all as the connection', () => {
    expect(describeAuthError({ name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 }))
      .toMatch(/Couldn't reach Snag/);
    expect(describeAuthError({ name: 'AbortError', message: 'The operation was aborted.' }))
      .toMatch(/Couldn't reach Snag/);
  });

  // Hiding an unfamiliar reason leaves nobody able to say what happened.
  it('passes on anything it does not recognise, as Auth said it', () => {
    expect(describeAuthError({ code: 'something_new', message: 'A new thing went wrong' }))
      .toBe('A new thing went wrong');
    expect(describeAuthError({})).toBe('Something went wrong. Please try again.');
  });
});
