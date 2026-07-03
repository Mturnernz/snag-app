import { useCallback, useEffect, useState } from 'react';
import { supabase, type Snag } from '../lib/supabase';

// Just the snag row + a reload fn. Sections of the investigation record
// have their own hooks so saving one thing never refetches everything.
export function useSnag(snagId: string | undefined) {
  const [snag, setSnag] = useState<Snag | null>(null);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);

  const reload = useCallback(async () => {
    if (!snagId) return;
    const { data } = await supabase.from('snags').select('*').eq('id', snagId).maybeSingle();
    setSnag(data);
    if (data) {
      const { data: editable } = await supabase.rpc('can_edit_site', { p_site_id: data.site_id });
      setCanEdit(editable === true);
    }
    setLoading(false);
  }, [snagId]);

  useEffect(() => {
    setLoading(true);
    reload();
  }, [reload]);

  return { snag, loading, canEdit, reload };
}
