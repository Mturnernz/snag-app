import { buildJoinLink, parseScannedJoinCode } from './joinLink';

// The join QR used to encode the bare code, so it only worked for someone who
// already had SNAG open on its scanner — useless on a poster whose audience is
// people without the app. It encodes a link now. The scanner has to keep taking
// the bare form, because those posters are printed and on walls.

jest.mock('react-native', () => ({ Platform: { OS: 'web' }, Linking: { getInitialURL: jest.fn() } }));

describe('buildJoinLink', () => {
  it('points at the app host, not the portal', () => {
    expect(buildJoinLink('VDJQFNEM')).toBe('https://app.snaghq.co.nz/?join=VDJQFNEM');
  });
});

describe('parseScannedJoinCode', () => {
  it('reads the code out of a link', () => {
    expect(parseScannedJoinCode('https://app.snaghq.co.nz/?join=VDJQFNEM')).toBe('VDJQFNEM');
  });

  it('still accepts a bare code — those posters are already on walls', () => {
    expect(parseScannedJoinCode('VDJQFNEM')).toBe('VDJQFNEM');
  });

  it('accepts the 10-char lowercase hex of orgs that predate the current format', () => {
    expect(parseScannedJoinCode('b9643ab31f')).toBe('b9643ab31f');
  });

  it('accepts the old host, whose printed codes still have to work', () => {
    expect(parseScannedJoinCode('https://snagv1.netlify.app/?join=VDJQFNEM')).toBe('VDJQFNEM');
  });

  it('tolerates the whitespace a scanner can pick up', () => {
    expect(parseScannedJoinCode('  VDJQFNEM \n')).toBe('VDJQFNEM');
  });

  it.each([
    ['', 'empty'],
    ['https://example.com/', 'a URL with no join param'],
    ['https://app.snaghq.co.nz/?report=abc123', 'a site report QR — a different code entirely'],
    ['VDJQ', 'too short to be either format'],
    ['VDJQFNEMVDJQFNEM', 'too long to be either format'],
    ['VDJQ-FNEM', 'not alphanumeric'],
    ['Some other QR code entirely', 'arbitrary text'],
  ])('rejects %j (%s)', (input) => {
    expect(parseScannedJoinCode(input)).toBeNull();
  });
});
