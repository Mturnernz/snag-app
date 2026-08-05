import { buildInviteLink, parseInviteToken } from './inviteLink';
import { PORTAL_URL } from './appUrl';

const TOKEN = 'e61cdd7a-c919-4b57-909a-d20ccaca718a';

describe('buildInviteLink', () => {
  it('points at the portal, not the app', () => {
    // The invitee has no account yet, so /go-style role routing can't happen
    // until they've accepted. The portal is what hosts that decision.
    expect(buildInviteLink(TOKEN)).toBe(`${PORTAL_URL}/join/${TOKEN}`);
  });

  it('round-trips through the parser', () => {
    expect(parseInviteToken(buildInviteLink(TOKEN))).toBe(TOKEN);
  });
});

describe('parseInviteToken', () => {
  it('accepts a bare token', () => {
    expect(parseInviteToken(TOKEN)).toBe(TOKEN);
  });

  it('accepts a token pasted with surrounding whitespace', () => {
    // Copying out of a mail client picks up a trailing newline more often than not.
    expect(parseInviteToken(`  ${TOKEN}\n`)).toBe(TOKEN);
  });

  it('accepts the link form, which is what the email actually contains', () => {
    expect(parseInviteToken(`https://www.snaghq.co.nz/join/${TOKEN}`)).toBe(TOKEN);
  });

  it('accepts a link with a trailing slash', () => {
    expect(parseInviteToken(`https://www.snaghq.co.nz/join/${TOKEN}/`)).toBe(TOKEN);
  });

  it('ignores the host, so an old or preview deployment still resolves', () => {
    expect(parseInviteToken(`http://localhost:3000/join/${TOKEN}`)).toBe(TOKEN);
  });

  it('rejects a join code, which is a different thing entirely', () => {
    // 8-char alphanumeric — parseScannedJoinCode's input, not this one's.
    expect(parseInviteToken('VDJQFNEM')).toBeNull();
  });

  it('rejects empty and malformed input', () => {
    expect(parseInviteToken('')).toBeNull();
    expect(parseInviteToken('   ')).toBeNull();
    expect(parseInviteToken('not-a-token')).toBeNull();
    expect(parseInviteToken('https://www.snaghq.co.nz/join/')).toBeNull();
  });
});
