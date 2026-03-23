import { createContext, useContext } from 'react';
import { Session } from '@supabase/supabase-js';
import { Profile } from '../types';

export interface UserProfileContextValue {
  session: Session | null;
  profile: Profile | null;
  userId: string | null;
  orgId: string | null;
  setProfile: (p: Profile | null) => void;
}

const UserProfileContext = createContext<UserProfileContextValue>({
  session: null,
  profile: null,
  userId: null,
  orgId: null,
  setProfile: () => {},
});

export function useUserProfile(): UserProfileContextValue {
  return useContext(UserProfileContext);
}

export default UserProfileContext;
