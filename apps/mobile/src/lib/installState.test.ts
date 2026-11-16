import { installPlatform, isInstalled, shouldOfferInstall } from './installState';

// Snag installs from the browser, so a tab has to be told there is anything to
// install, and an installed app must never be told again. These pin both
// halves, and which steps each phone gets.

const media = (matching: string[]) => (query: string) => ({ matches: matching.includes(query) });

describe('isInstalled', () => {
  it('is true for a home-screen launch in the manifest’s fullscreen mode', () => {
    expect(isInstalled({ matchMedia: media(['(display-mode: fullscreen)']) })).toBe(true);
  });

  it('is true for standalone, which is what iOS and older Chrome use', () => {
    expect(isInstalled({ matchMedia: media(['(display-mode: standalone)']) })).toBe(true);
  });

  it('is true for iOS’s own flag', () => {
    expect(isInstalled({ navigator: { standalone: true }, matchMedia: media([]) })).toBe(true);
  });

  it('is false in a browser tab', () => {
    expect(isInstalled({ matchMedia: media(['(display-mode: browser)']), navigator: {} })).toBe(false);
  });

  it('is false, not a crash, when matchMedia throws or is missing', () => {
    expect(isInstalled({ matchMedia: () => { throw new Error('no'); } })).toBe(false);
    expect(isInstalled({})).toBe(false);
  });
});

describe('installPlatform', () => {
  it('knows an iPhone', () => {
    expect(installPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit')).toBe('ios');
  });

  it('knows an iPad that says it is a Mac, by its touch screen', () => {
    expect(installPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit', 5)).toBe('ios');
  });

  it('does not take a real Mac for an iPad', () => {
    expect(installPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit', 0)).toBe('other');
  });

  it('knows Android', () => {
    expect(installPlatform('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit Chrome/140')).toBe('android');
  });

  it('offers nothing on a desktop browser', () => {
    expect(installPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140')).toBe('other');
  });
});

describe('shouldOfferInstall', () => {
  const base = { web: true, installed: false, platform: 'android' as const, dismissed: false };

  it('offers in a phone’s browser tab', () => {
    expect(shouldOfferInstall(base)).toBe(true);
  });

  it('never offers once installed, dismissed, off the web build or on a desktop', () => {
    expect(shouldOfferInstall({ ...base, installed: true })).toBe(false);
    expect(shouldOfferInstall({ ...base, dismissed: true })).toBe(false);
    expect(shouldOfferInstall({ ...base, web: false })).toBe(false);
    expect(shouldOfferInstall({ ...base, platform: 'other' })).toBe(false);
  });
});

// The list's card waits for the third opening: on the first it sat above the
// first job, asking somebody who had not used the app yet to install it.
describe('countInstallVisit', () => {
  const { countInstallVisit, resetInstallVisitCount, INSTALL_AFTER_VISITS } = require('./installState');
  const real = (globalThis as any).localStorage;
  afterEach(() => { (globalThis as any).localStorage = real; resetInstallVisitCount(); });

  it('counts each load once, and reaches the threshold on the third', () => {
    const held: Record<string, string> = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => held[k] ?? null,
      setItem: (k: string, v: string) => { held[k] = v; },
    };
    resetInstallVisitCount();
    expect(countInstallVisit()).toBe(1);
    expect(countInstallVisit()).toBe(1);
    resetInstallVisitCount();
    expect(countInstallVisit()).toBe(2);
    resetInstallVisitCount();
    expect(countInstallVisit()).toBe(INSTALL_AFTER_VISITS);
  });

  it('says enough when storage is absent or throws, so the card still shows', () => {
    (globalThis as any).localStorage = undefined;
    expect(countInstallVisit()).toBe(INSTALL_AFTER_VISITS);
    (globalThis as any).localStorage = { getItem: () => { throw new Error('no'); }, setItem: () => {} };
    resetInstallVisitCount();
    expect(countInstallVisit()).toBe(INSTALL_AFTER_VISITS);
  });
});
