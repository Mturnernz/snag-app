import { useCallback, useEffect, useState } from 'react';
import { supabase, type Tables } from '../lib/supabase';

// The investigation record around a serious snag. Each section loads and
// reloads independently so saving one thing never refetches the rest.
export function useSnagRecord(snagId: string | undefined) {
  const [checklist, setChecklist] = useState<Tables<'checklist_completions'>[]>([]);
  const [witnesses, setWitnesses] = useState<Tables<'witness_statements'>[]>([]);
  const [evidence, setEvidence] = useState<Tables<'evidence_items'>[]>([]);
  const [investigation, setInvestigation] = useState<Tables<'investigations'> | null>(null);
  const [actions, setActions] = useState<Tables<'corrective_actions'>[]>([]);

  const reloadChecklist = useCallback(async () => {
    if (!snagId) return;
    const { data } = await supabase.from('checklist_completions').select('*').eq('snag_id', snagId);
    setChecklist(data ?? []);
  }, [snagId]);

  const reloadWitnesses = useCallback(async () => {
    if (!snagId) return;
    const { data } = await supabase
      .from('witness_statements').select('*').eq('snag_id', snagId).order('taken_at');
    setWitnesses(data ?? []);
  }, [snagId]);

  const reloadEvidence = useCallback(async () => {
    if (!snagId) return;
    const { data } = await supabase
      .from('evidence_items').select('*').eq('snag_id', snagId).order('sort_index');
    setEvidence(data ?? []);
  }, [snagId]);

  const reloadInvestigation = useCallback(async () => {
    if (!snagId) return;
    const { data } = await supabase
      .from('investigations').select('*').eq('snag_id', snagId).maybeSingle();
    setInvestigation(data);
  }, [snagId]);

  const reloadActions = useCallback(async () => {
    if (!snagId) return;
    const { data } = await supabase
      .from('corrective_actions').select('*').eq('snag_id', snagId).order('created_at');
    setActions(data ?? []);
  }, [snagId]);

  useEffect(() => {
    reloadChecklist();
    reloadWitnesses();
    reloadEvidence();
    reloadInvestigation();
    reloadActions();
  }, [reloadChecklist, reloadWitnesses, reloadEvidence, reloadInvestigation, reloadActions]);

  return {
    checklist, reloadChecklist,
    witnesses, reloadWitnesses,
    evidence, reloadEvidence,
    investigation, reloadInvestigation,
    actions, reloadActions,
  };
}
