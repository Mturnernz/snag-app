import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  ReportSite, getLastReportSiteId, setLastReportSiteId, pickReportSite, resolveReportSite,
} from './reportSite';

const ORG = 'org-1';
const OTHER_ORG = 'org-2';

const HENDO: ReportSite = { id: 'site-hendo', name: 'Hendo' };
const NSP: ReportSite = { id: 'site-nsp', name: 'NSP' };
const PUBLIC: ReportSite = { id: 'site-public', name: 'Public' };
const SITES = [HENDO, NSP, PUBLIC];

const reset = () => (AsyncStorage as unknown as { __reset: () => void }).__reset();

beforeEach(reset);

describe('pickReportSite', () => {
  it('returns the last-used site when it is still on offer', () => {
    expect(pickReportSite(SITES, NSP.id)).toEqual(NSP);
  });

  it('falls back to the first site when nothing was stored', () => {
    expect(pickReportSite(SITES, null)).toEqual(HENDO);
  });

  // Someone removed from a site keeps the stored id until they next pick.
  it('falls back to the first site when the stored one is no longer offered', () => {
    expect(pickReportSite([NSP, PUBLIC], HENDO.id)).toEqual(NSP);
  });

  it('returns null when the reporter has no sites at all', () => {
    expect(pickReportSite([], HENDO.id)).toBeNull();
  });
});

describe('the stored preference', () => {
  it('survives a round trip', async () => {
    await setLastReportSiteId(ORG, NSP.id);
    expect(await getLastReportSiteId(ORG)).toBe(NSP.id);
  });

  // "My site" is a different answer in each org, so the two must not share.
  it('is kept per organisation', async () => {
    await setLastReportSiteId(ORG, NSP.id);
    expect(await getLastReportSiteId(OTHER_ORG)).toBeNull();
  });

  it('drives which site the form opens on', async () => {
    expect(await resolveReportSite(ORG, SITES)).toEqual(HENDO);
    await setLastReportSiteId(ORG, PUBLIC.id);
    expect(await resolveReportSite(ORG, SITES)).toEqual(PUBLIC);
  });
});
