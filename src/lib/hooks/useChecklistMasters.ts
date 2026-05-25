'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ChecklistMaster } from '@/lib/types';
import { ChecklistSection } from '@/components/checklist/types';

export interface AssignResult {
  created: number;
  skipped: number;
  overwritten: number;
  errors: string[];
}

export function useChecklistMasters(orgId: string | null) {
  const supabase = useMemo(() => createClient(), []);
  const [masters, setMasters] = useState<ChecklistMaster[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return; }
    const { data } = await supabase
      .from('checklist_masters')
      .select('*')
      .eq('org_id', orgId)
      .order('updated_at', { ascending: false });
    if (data) setMasters(data as ChecklistMaster[]);
    setLoading(false);
  }, [orgId, supabase]);

  useEffect(() => { load(); }, [load]);

  const addMaster = useCallback(async (
    name: string,
    sections: ChecklistSection[] = [],
    description = '',
  ): Promise<ChecklistMaster | null> => {
    if (!orgId) return null;
    const { data, error } = await supabase
      .from('checklist_masters')
      .insert({ org_id: orgId, name, sections, description })
      .select()
      .single();
    if (error || !data) return null;
    const newItem = data as ChecklistMaster;
    setMasters(prev => [newItem, ...prev]);
    return newItem;
  }, [orgId, supabase]);

  const updateMaster = useCallback(async (
    id: string,
    updates: Partial<Pick<ChecklistMaster, 'name' | 'sections' | 'description'>>,
  ): Promise<void> => {
    await supabase
      .from('checklist_masters')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id);
    setMasters(prev => prev.map(m => m.id === id ? { ...m, ...updates, updated_at: new Date().toISOString() } : m));
  }, [supabase]);

  const deleteMaster = useCallback(async (id: string): Promise<void> => {
    await supabase.from('checklist_masters').delete().eq('id', id);
    setMasters(prev => prev.filter(m => m.id !== id));
  }, [supabase]);

  const duplicateMaster = useCallback(async (id: string): Promise<ChecklistMaster | null> => {
    const source = masters.find(m => m.id === id);
    if (!source) return null;
    return addMaster(`${source.name} (Copy)`, source.sections, source.description);
  }, [masters, addMaster]);

  /**
   * Bulk-assign a master template's sections to multiple clients.
   * Creates client_checklists rows with the template's sections copied in.
   * @param overwrite If true, overwrites existing checklists from the same template.
   */
  const assignToClients = useCallback(async (
    masterId: string,
    clientIds: string[],
    overwrite = false,
  ): Promise<AssignResult> => {
    const result: AssignResult = { created: 0, skipped: 0, overwritten: 0, errors: [] };
    if (!orgId || clientIds.length === 0) return result;

    const master = masters.find(m => m.id === masterId);
    if (!master) { result.errors.push('Template not found'); return result; }

    // Check which clients already have a checklist from this template
    const { data: existing } = await supabase
      .from('client_checklists')
      .select('id, client_id')
      .eq('org_id', orgId)
      .eq('source_template_id', masterId)
      .in('client_id', clientIds);

    const existingByClient = new Map<string, string>();
    if (existing) {
      for (const row of existing) {
        existingByClient.set(row.client_id, row.id);
      }
    }

    // Check which clients have ANY default checklist
    const { data: defaults } = await supabase
      .from('client_checklists')
      .select('client_id')
      .eq('org_id', orgId)
      .eq('is_default', true)
      .in('client_id', clientIds);

    const clientsWithDefault = new Set<string>();
    if (defaults) {
      for (const row of defaults) clientsWithDefault.add(row.client_id);
    }

    for (const clientId of clientIds) {
      const existingId = existingByClient.get(clientId);

      if (existingId && !overwrite) {
        result.skipped++;
        continue;
      }

      if (existingId && overwrite) {
        // Update existing
        const { error } = await supabase
          .from('client_checklists')
          .update({
            name: master.name,
            sections: master.sections,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingId);
        if (error) { result.errors.push(`Failed for client ${clientId}: ${error.message}`); }
        else { result.overwritten++; }
        continue;
      }

      // Create new — set as default if client has no default yet
      const isDefault = !clientsWithDefault.has(clientId);
      const { error } = await supabase
        .from('client_checklists')
        .insert({
          org_id: orgId,
          client_id: clientId,
          name: master.name,
          sections: master.sections,
          is_default: isDefault,
          source_template_id: masterId,
        });
      if (error) { result.errors.push(`Failed for client ${clientId}: ${error.message}`); }
      else {
        result.created++;
        if (isDefault) clientsWithDefault.add(clientId);
      }
    }

    return result;
  }, [orgId, supabase, masters]);

  return {
    masters,
    loading,
    reload: load,
    addMaster,
    updateMaster,
    deleteMaster,
    duplicateMaster,
    assignToClients,
  };
}
