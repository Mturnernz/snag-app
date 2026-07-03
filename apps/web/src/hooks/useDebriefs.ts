import { useCallback, useEffect, useState } from 'react';
import { supabase, type Tables } from '../lib/supabase';

export function useDebriefs(snagId: string | undefined) {
  const [debriefs, setDebriefs] = useState<Tables<'snag_debriefs'>[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!snagId) return;
    const { data } = await supabase
      .from('snag_debriefs')
      .select('*')
      .eq('snag_id', snagId)
      .order('started_at', { ascending: false });
    setDebriefs(data ?? []);
    setLoading(false);
  }, [snagId]);

  useEffect(() => {
    setLoading(true);
    reload();
  }, [reload]);

  return { debriefs, loading, reload };
}

// One debrief with its findings/attendees/lessons, each independently reloadable.
export function useDebrief(debriefId: string | undefined) {
  const [debrief, setDebrief] = useState<Tables<'snag_debriefs'> | null>(null);
  const [findings, setFindings] = useState<Tables<'debrief_findings'>[]>([]);
  const [attendees, setAttendees] = useState<Tables<'debrief_attendees'>[]>([]);
  const [lessons, setLessons] = useState<Tables<'debrief_lessons'>[]>([]);
  const [loading, setLoading] = useState(true);

  const reloadDebrief = useCallback(async () => {
    if (!debriefId) return;
    const { data } = await supabase
      .from('snag_debriefs').select('*').eq('id', debriefId).maybeSingle();
    setDebrief(data);
    setLoading(false);
  }, [debriefId]);

  const reloadFindings = useCallback(async () => {
    if (!debriefId) return;
    const { data } = await supabase
      .from('debrief_findings').select('*').eq('debrief_id', debriefId).order('created_at');
    setFindings(data ?? []);
  }, [debriefId]);

  const reloadAttendees = useCallback(async () => {
    if (!debriefId) return;
    const { data } = await supabase
      .from('debrief_attendees').select('*').eq('debrief_id', debriefId).order('created_at');
    setAttendees(data ?? []);
  }, [debriefId]);

  const reloadLessons = useCallback(async () => {
    if (!debriefId) return;
    const { data } = await supabase
      .from('debrief_lessons').select('*').eq('debrief_id', debriefId).order('created_at');
    setLessons(data ?? []);
  }, [debriefId]);

  useEffect(() => {
    setLoading(true);
    reloadDebrief();
    reloadFindings();
    reloadAttendees();
    reloadLessons();
  }, [reloadDebrief, reloadFindings, reloadAttendees, reloadLessons]);

  return {
    debrief, reloadDebrief,
    findings, reloadFindings,
    attendees, reloadAttendees,
    lessons, reloadLessons,
    loading,
  };
}
