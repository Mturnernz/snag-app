import AsyncStorage from '@react-native-async-storage/async-storage';

// Which site a reporter files into.
//
// Before this there was no choice: getDefaultSiteId took my_member_site_ids()[0],
// and that RPC has no ORDER BY — so someone on three sites sent every report to
// whichever row Postgres happened to return first, with nothing in the UI even
// naming it. The picker below is the choice; this module is the memory of it.
//
// Stored per org, because "my site" is a different answer in each one, and a
// multi-org member switching orgs on the report screen should land on the site
// they last used *there*.

export interface ReportSite {
  id: string;
  name: string;
}

const KEY_PREFIX = 'snag.lastReportSite.';

export async function getLastReportSiteId(orgId: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY_PREFIX + orgId);
  } catch {
    // A preference is not worth failing a report over — fall back to the
    // first site, exactly as a reporter with no stored choice gets.
    return null;
  }
}

export async function setLastReportSiteId(orgId: string, siteId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_PREFIX + orgId, siteId);
  } catch {
    // Same reasoning: the report still goes to the site they picked.
  }
}

/**
 * Which site the report form opens on: the one last used here if it's still
 * offered, otherwise the first. Sites arrive ordered by name, so the fallback
 * is at least stable between two loads — the old behaviour wasn't.
 */
export function pickReportSite(sites: ReportSite[], lastUsedId: string | null): ReportSite | null {
  if (sites.length === 0) return null;
  return sites.find((s) => s.id === lastUsedId) ?? sites[0];
}

export async function resolveReportSite(orgId: string, sites: ReportSite[]): Promise<ReportSite | null> {
  return pickReportSite(sites, await getLastReportSiteId(orgId));
}
