import { useCallback, useEffect, useState } from 'react';
import { supabase, type Tables } from '../lib/supabase';

// Latest RCA on a snag + its why steps.
export function useRca(snagId: string | undefined) {
  const [rca, setRca] = useState<Tables<'snag_rca'> | null>(null);
  const [whySteps, setWhySteps] = useState<Tables<'rca_why_steps'>[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!snagId) return;
    const { data: rcaRow } = await supabase
      .from('snag_rca')
      .select('*')
      .eq('snag_id', snagId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setRca(rcaRow);
    if (rcaRow) {
      const { data: steps } = await supabase
        .from('rca_why_steps').select('*').eq('rca_id', rcaRow.id).order('why_index');
      setWhySteps(steps ?? []);
    } else {
      setWhySteps([]);
    }
    setLoading(false);
  }, [snagId]);

  useEffect(() => {
    setLoading(true);
    reload();
  }, [reload]);

  return { rca, whySteps, loading, reload };
}
