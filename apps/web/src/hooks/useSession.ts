import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, type Profile } from '../lib/supabase';

interface SessionState {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
}

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({
    loading: true,
    session: null,
    profile: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function load(session: Session | null) {
      let profile: Profile | null = null;
      if (session) {
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .maybeSingle();
        profile = data;
      }
      if (!cancelled) setState({ loading: false, session, profile });
    }

    supabase.auth.getSession().then(({ data: { session } }) => load(session));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      load(session);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return state;
}
