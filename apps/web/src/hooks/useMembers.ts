import { useEffect, useState } from 'react';
import { supabase, type Profile } from '../lib/supabase';

export function useMembers() {
  const [members, setMembers] = useState<Profile[]>([]);

  useEffect(() => {
    supabase
      .from('profiles')
      .select('*')
      .order('name')
      .then(({ data }) => setMembers(data ?? []));
  }, []);

  function memberName(id: string | null | undefined): string {
    if (!id) return 'Nobody';
    return members.find((m) => m.id === id)?.name || 'Someone';
  }

  return { members, memberName };
}
