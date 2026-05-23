'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { SupabaseClient } from '@supabase/supabase-js';
import { FieldResponse, PreFillMeta } from '@/components/checklist/types';

interface UseChecklistCompletionOptions {
  supabase: SupabaseClient;
  orgId: string;
  clientId: string;
  checklistId: string | null;
  scheduleJobId: string | null; // the app-level Client.id used as schedule_job_id
  preFill?: PreFillMeta;
}

export function useChecklistCompletion({
  supabase, orgId, clientId, checklistId, scheduleJobId, preFill,
}: UseChecklistCompletionOptions) {
  const [completionId, setCompletionId] = useState<string | null>(null);
  const [responses, setResponses] = useState<FieldResponse[]>([]);
  const [status, setStatus] = useState<'in_progress' | 'submitted'>('in_progress');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Debounce save timer
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestResponses = useRef<FieldResponse[]>([]);
  latestResponses.current = responses;

  // ─── Load existing completion ─────────────────────────────────────────────
  useEffect(() => {
    if (!orgId || !clientId) return;
    setLoading(true);

    let query = supabase
      .from('checklist_completions')
      .select('id, items, status, pre_fill')
      .eq('org_id', orgId)
      .eq('client_id', clientId);

    if (scheduleJobId) query = query.eq('schedule_job_id', scheduleJobId);
    if (checklistId) query = query.eq('checklist_id', checklistId);

    query.eq('status', 'in_progress').maybeSingle()
      .then(({ data }: { data: { id: string; items: FieldResponse[]; status: string; pre_fill: PreFillMeta | null } | null }) => {
        if (data) {
          setCompletionId(data.id);
          setResponses(data.items || []);
          setStatus(data.status as 'in_progress' | 'submitted');
        }
        setLoading(false);
      });
  }, [supabase, orgId, clientId, checklistId, scheduleJobId]);

  // ─── Upsert completion record & save responses ────────────────────────────
  const persistResponses = useCallback(async (newResponses: FieldResponse[]) => {
    if (!orgId || !clientId) return;
    setSaving(true);

    if (!completionId) {
      // Create new completion
      const { data } = await supabase.from('checklist_completions').insert({
        org_id: orgId,
        client_id: clientId,
        checklist_id: checklistId,
        schedule_job_id: scheduleJobId,
        items: newResponses,
        status: 'in_progress',
        pre_fill: preFill || null,
      }).select('id').single() as { data: { id: string } | null };
      if (data) setCompletionId(data.id);
    } else {
      await supabase.from('checklist_completions')
        .update({ items: newResponses })
        .eq('id', completionId);
    }
    setSaving(false);
  }, [supabase, orgId, clientId, checklistId, scheduleJobId, completionId, preFill]);

  // ─── Debounced onChange ───────────────────────────────────────────────────
  const handleResponseChange = useCallback((updated: FieldResponse[]) => {
    setResponses(updated);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      persistResponses(updated);
    }, 1500); // 1.5s debounce
  }, [persistResponses]);

  // ─── Submit ───────────────────────────────────────────────────────────────
  const submit = useCallback(async () => {
    if (!orgId || !clientId) return;
    const now = new Date().toISOString();

    if (!completionId) {
      const { data } = await supabase.from('checklist_completions').insert({
        org_id: orgId,
        client_id: clientId,
        checklist_id: checklistId,
        schedule_job_id: scheduleJobId,
        items: latestResponses.current,
        status: 'submitted',
        submitted_at: now,
        pre_fill: preFill || null,
      }).select('id').single() as { data: { id: string } | null };
      if (data) setCompletionId(data.id);
    } else {
      await supabase.from('checklist_completions')
        .update({ status: 'submitted', submitted_at: now })
        .eq('id', completionId);
    }
    setStatus('submitted');
  }, [supabase, orgId, clientId, checklistId, scheduleJobId, completionId, preFill]);

  return { completionId, responses, status, loading, saving, handleResponseChange, submit };
}
