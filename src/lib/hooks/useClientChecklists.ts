'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ClientChecklist, ChecklistSection } from '@/lib/types';
import { generateId } from '@/lib/timeUtils';

export function useClientChecklists(clientId: string | null, orgId: string | null) {
  const supabase = useMemo(() => createClient(), []);
  const [checklists, setChecklists] = useState<ClientChecklist[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!clientId || !orgId) { setLoading(false); return; }
    const { data } = await supabase
      .from('client_checklists')
      .select('*')
      .eq('client_id', clientId)
      .eq('org_id', orgId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });
    if (data) setChecklists(data as ClientChecklist[]);
    setLoading(false);
  }, [clientId, orgId, supabase]);

  useEffect(() => { load(); }, [load]);

  const defaultChecklist = checklists.find(c => c.is_default) || checklists[0] || null;

  const addChecklist = useCallback(async (
    name: string,
    sections: ChecklistSection[] = [],
    isDefault = false,
  ): Promise<ClientChecklist | null> => {
    if (!clientId || !orgId) return null;

    // If setting as default, clear other defaults first
    if (isDefault && checklists.length > 0) {
      await supabase
        .from('client_checklists')
        .update({ is_default: false })
        .eq('client_id', clientId);
    }

    const { data, error } = await supabase
      .from('client_checklists')
      .insert({ org_id: orgId, client_id: clientId, name, sections, is_default: isDefault })
      .select()
      .single();

    if (error || !data) return null;
    const newItem = data as ClientChecklist;
    setChecklists(prev =>
      isDefault
        ? [newItem, ...prev.map(c => ({ ...c, is_default: false }))]
        : [...prev, newItem]
    );
    return newItem;
  }, [clientId, orgId, supabase, checklists]);

  const updateChecklist = useCallback(async (
    id: string,
    updates: Partial<Pick<ClientChecklist, 'name' | 'sections' | 'is_default'>>,
  ): Promise<void> => {
    if (!clientId) return;

    // If setting this one as default, clear others
    if (updates.is_default) {
      await supabase
        .from('client_checklists')
        .update({ is_default: false })
        .eq('client_id', clientId)
        .neq('id', id);
    }

    await supabase
      .from('client_checklists')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id);

    setChecklists(prev =>
      prev.map(c => {
        if (c.id === id) return { ...c, ...updates };
        if (updates.is_default) return { ...c, is_default: false };
        return c;
      })
    );
  }, [clientId, supabase]);

  const deleteChecklist = useCallback(async (id: string): Promise<void> => {
    await supabase.from('client_checklists').delete().eq('id', id);
    setChecklists(prev => prev.filter(c => c.id !== id));
  }, [supabase]);

  const setDefault = useCallback(async (id: string): Promise<void> => {
    await updateChecklist(id, { is_default: true });
  }, [updateChecklist]);

  /** Create an empty default checklist for a brand-new client */
  const createDefaultChecklist = useCallback(async (): Promise<ClientChecklist | null> => {
    return addChecklist('Default', [
      {
        id: generateId(),
        title: 'General',
        items: [{ id: generateId(), text: 'Check entry and lock up after', required: true }],
      },
    ], true);
  }, [addChecklist]);

  return {
    checklists,
    defaultChecklist,
    loading,
    reload: load,
    addChecklist,
    updateChecklist,
    deleteChecklist,
    setDefault,
    createDefaultChecklist,
  };
}
