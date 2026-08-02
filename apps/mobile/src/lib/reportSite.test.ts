import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  ReportSite, getCachedReportSiteId, cacheReportSiteId, pickReportSite, resolveReportSite,
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
  it('returns the preferred site when it is still on offer', () => {
    expect(pickReportSite(SITES, NSP.id)).toEqual(NSP);
  });

  it('falls back to the first site when there is no preference', () => {
    expect(pickReportSite(SITES, null)).toEqual(HENDO);
  });

  // Someone removed from a site keeps the stored id until they next report.
  it('falls back to the first site when the preferred one is no longer offered', () => {
    expect(pickReportSite([NSP, PUBLIC], HENDO.id)).toEqual(NSP);
  });

  it('returns null when the reporter has no sites at all', () => {
    expect(pickReportSite([], HENDO.id)).toBeNull();
  });
});

describe('resolveReportSite', () => {
  it('defaults to the site last reported into', async () => {
    expect(await resolveReportSite(ORG, SITES, PUBLIC.id)).toEqual(PUBLIC);
  });

  it('defaults to the first site for someone who has never reported here', async () => {
    expect(await resolveReportSite(ORG, SITES, null)).toEqual(HENDO);
  });

  // The last-reported query needs the network; the cache is what stands in for
  // it offline, which is also when a report most needs the right site.
  it('falls back to the cached site when the last-reported one is unknown', async () => {
    await resolveReportSite(ORG, SITES, NSP.id);
    expect(await resolveReportSite(ORG, SITES, null)).toEqual(NSP);
  });

  it('caches the last-reported site as it resolves', async () => {
    await resolveReportSite(ORG, SITES, NSP.id);
    expect(await getCachedReportSiteId(ORG)).toBe(NSP.id);
  });

  // "My site" is a different answer in each org, so the two must not share.
  it('keeps the cache per organisation', async () => {
    await cacheReportSiteId(ORG, NSP.id);
    expect(await getCachedReportSiteId(OTHER_ORG)).toBeNull();
    expect(await resolveReportSite(OTHER_ORG, SITES, null)).toEqual(HENDO);
  });
});
