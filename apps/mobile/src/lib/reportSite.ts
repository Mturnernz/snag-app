import AsyncStorage from '@react-native-async-storage/async-storage';

// Which site a reporter files into.
//
// Before this there was no choice: getDefaultSiteId took my_member_site_ids()[0],
// and that RPC has no ORDER BY — so someone on three sites sent every report to
// whichever row Postgres happened to return first, with nothing in the UI even
// naming it. SitePicker is the choice; this module decides what it opens on.
//
// The default is the site they last actually reported into, read from their
// own snags (getLastReportedSiteId) rather than from a tap: what someone
// reported is a better account of where they work than what they once selected
// and abandoned. That query needs the network, so the answer is also cached
// here — per org, because "my site" is a different answer in each one, and a
// multi-org member switching orgs should land on the site they last used
// *there*.

export interface ReportSite {
  id: string;
  name: string;
}

const KEY_PREFIX = 'snag.lastReportSite.';

export async function getCachedReportSiteId(orgId: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY_PREFIX + orgId);
  } catch {
    // A remembered default is not worth failing a report over — fall back to
    // the first site, exactly as a first-time reporter does.
    return null;
  }
}

export async function cacheReportSiteId(orgId: string, siteId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_PREFIX + orgId, siteId);
  } catch {
    // Same reasoning: the report still goes to the site that's selected.
  }
}

/**
 * Which site to select, given the sites on offer and a preferred id. Falls
 * back to the first — sites arrive ordered by name, so that at least means the
 * same site on two consecutive loads, which the old behaviour couldn't promise.
 */
export function pickReportSite(sites: ReportSite[], preferredId: string | null): ReportSite | null {
  if (sites.length === 0) return null;
  return sites.find((s) => s.id === preferredId) ?? sites[0];
}

/**
 * The form's opening selection: last reported here, else the last one cached
 * on this device (the offline path), else the first by name.
 *
 * `lastReportedSiteId` comes from getLastReportedSiteId and is null when the
 * reporter is new to this org or the call didn't reach the server.
 */
export async function resolveReportSite(
  orgId: string,
  sites: ReportSite[],
  lastReportedSiteId: string | null
): Promise<ReportSite | null> {
  if (lastReportedSiteId) await cacheReportSiteId(orgId, lastReportedSiteId);
  const preferred = lastReportedSiteId ?? await getCachedReportSiteId(orgId);
  return pickReportSite(sites, preferred);
}
