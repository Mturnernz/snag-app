import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { supabase, getUnseenMentionCount } from '../lib/supabase';

interface BadgeContextValue {
  /** Flagged, unmerged snags in the active org — shown on the Snags tab. */
  openIssueCount: number;
  /** Re-fetch the count. Call after anything that could flip a snag into
   *  or out of "flagged" (status changes, merges) instead of waiting for
   *  the app to background/foreground. */
  refreshOpenIssueCount: () => void;
  /** Unseen @mentions of me in the active org — shown on the Profile tab. */
  mentionCount: number;
  /** Re-fetch the count. Call after sending a comment (someone else might
   *  mention themselves back) or after viewing/clearing mentions. */
  refreshMentionCount: () => void;
}

const BadgeContext = createContext<BadgeContextValue | null>(null);

export function BadgeProvider({ children }: { children: React.ReactNode }) {
  const [openIssueCount, setOpenIssueCount] = useState(0);
  const [mentionCount, setMentionCount] = useState(0);

  const refreshOpenIssueCount = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase
      .from('profiles')
      .select('org_id')
      .eq('id', user.id)
      .single();
    if (!profile?.org_id) return;
    const { count } = await supabase
      .from('snags')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', profile.org_id)
      .eq('status', 'flagged')
      .is('parent_snag_id', null);
    setOpenIssueCount(count ?? 0);
  }, []);

  const refreshMentionCount = useCallback(async () => {
    setMentionCount(await getUnseenMentionCount());
  }, []);

  useEffect(() => {
    refreshOpenIssueCount();
    refreshMentionCount();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refreshOpenIssueCount();
        refreshMentionCount();
      }
    });
    return () => sub.remove();
  }, [refreshOpenIssueCount, refreshMentionCount]);

  return (
    <BadgeContext.Provider value={{ openIssueCount, refreshOpenIssueCount, mentionCount, refreshMentionCount }}>
      {children}
    </BadgeContext.Provider>
  );
}

export function useBadge(): BadgeContextValue {
  const ctx = useContext(BadgeContext);
  if (!ctx) {
    throw new Error('useBadge must be used within a BadgeProvider');
  }
  return ctx;
}
