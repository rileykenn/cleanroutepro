'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

import { Client } from '@/lib/types';
import { ChecklistSection, migrateOldSection } from '@/components/checklist/types';
import { useClientChecklists } from '@/lib/hooks/useClientChecklists';
import ChecklistBuilder from '@/components/checklist/ChecklistBuilder';
import { createClient as createSupabaseClient } from '@/lib/supabase/client';

interface ClientChecklistPanelProps {
  client: Client;
  orgId: string;
  isAdmin?: boolean;
  scheduleJobId?: string;
  onClose: () => void;
}

export default function ClientChecklistPanel({
  client, orgId, isAdmin = false,
  onClose,
}: ClientChecklistPanelProps) {
  const supabase = useMemo(() => createSupabaseClient(), []);

  const savedClientId = client.savedClientId || '';
  const {
    checklists, defaultChecklist, loading: checklistsLoading,
    addChecklist, updateChecklist, reload: reloadChecklists,
  } = useClientChecklists(savedClientId || null, orgId);

  // Which checklist is currently selected
  const [activeChecklistId, setActiveChecklistId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'created'>('idle');

  // Resolve the active checklist
  const activeChecklist = useMemo(() => {
    if (activeChecklistId) return checklists.find(c => c.id === activeChecklistId) || null;
    if (client.checklistId) return checklists.find(c => c.id === client.checklistId) || null;
    return defaultChecklist || null;
  }, [activeChecklistId, client.checklistId, checklists, defaultChecklist]);

  // Editable sections (initially loaded from the active checklist)
  const [editorSections, setEditorSections] = useState<ChecklistSection[]>([]);
  const [editorInitialized, setEditorInitialized] = useState(false);

  // Load sections when active checklist changes
  useEffect(() => {
    if (!activeChecklist) {
      setEditorSections([{ id: crypto.randomUUID(), title: '', fields: [] }]);
      setEditorInitialized(true);
      return;
    }
    const migrated = activeChecklist.sections.map(s =>
      migrateOldSection(s as unknown as Record<string, unknown>)
    );
    setEditorSections(migrated.length > 0 ? migrated : [{ id: crypto.randomUUID(), title: '', fields: [] }]);
    setEditorInitialized(true);
    setSaveStatus('idle');
  }, [activeChecklist]);

  // Access instructions
  const [accessInstructions, setAccessInstructions] = useState<string | null>(null);
  const [showAccess, setShowAccess] = useState(false);
  useEffect(() => {
    if (!savedClientId) return;
    supabase.from('clients').select('access_instructions').eq('id', savedClientId).single()
      .then(({ data }: { data: { access_instructions: string | null } | null }) => {
        setAccessInstructions(data?.access_instructions || null);
      });
  }, [savedClientId, supabase]);

  // ── Save: overwrite current checklist ──
  const handleSave = useCallback(async (name: string, sections: ChecklistSection[], isDefault: boolean) => {
    if (!activeChecklist || !savedClientId) return;
    setSaving(true);
    try {
      await updateChecklist(activeChecklist.id, { name, sections, is_default: isDefault });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } finally {
      setSaving(false);
    }
  }, [activeChecklist, savedClientId, updateChecklist]);

  // ── Save As New: create a new checklist for this client ──
  const handleSaveAsNew = useCallback(async (name: string, sections: ChecklistSection[]) => {
    if (!savedClientId) return;
    setSaving(true);
    try {
      const newCl = await addChecklist(name, sections, false);
      if (newCl) {
        await reloadChecklists();
        setActiveChecklistId(newCl.id);
        setSaveStatus('created');
        setTimeout(() => setSaveStatus('idle'), 2000);
      }
    } finally {
      setSaving(false);
    }
  }, [savedClientId, addChecklist, reloadChecklists]);

  // Handle switching checklists
  const handleSwitchChecklist = useCallback((id: string) => {
    setActiveChecklistId(id);
    setEditorInitialized(false);
    setSaveStatus('idle');
  }, []);

  if (!savedClientId) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-sm text-text-secondary">No client linked to this job.</p>
          <p className="text-xs text-text-tertiary mt-1">Add a saved client to use checklists.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white rounded-2xl shadow-sm border border-border-light overflow-hidden">

      {/* ── Header ── */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-border-light">
        <button onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-surface-elevated text-text-tertiary hover:text-text-primary transition-colors shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>

        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-text-primary truncate">{client.name}</h2>
          <p className="text-[11px] text-text-tertiary truncate">
            {activeChecklist ? `Editing: ${activeChecklist.name}` : 'No checklist selected'}
          </p>
        </div>

        {/* Save status indicator */}
        <AnimatePresence>
          {saveStatus !== 'idle' && (
            <motion.span
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-emerald-50 text-emerald-600 shrink-0"
            >
              {saveStatus === 'saved' ? '✓ Saved' : '✓ Created'}
            </motion.span>
          )}
        </AnimatePresence>

        {/* Checklist picker */}
        {checklists.length > 0 && (
          <select
            value={activeChecklistId || activeChecklist?.id || ''}
            onChange={e => handleSwitchChecklist(e.target.value)}
            className="input-field text-xs py-1.5 max-w-[140px] shrink-0"
          >
            {checklists.map(cl => (
              <option key={cl.id} value={cl.id}>
                {cl.name}{cl.is_default ? ' (default)' : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* ── Access instructions accordion ── */}
      {accessInstructions && (
        <div className="shrink-0 border-b border-border-light">
          <button onClick={() => setShowAccess(!showAccess)}
            className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-amber-50 transition-colors">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-500 shrink-0">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
            </svg>
            <span className="text-xs font-semibold text-amber-700 flex-1 text-left">Access Instructions</span>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              className={`text-amber-500 transition-transform ${showAccess ? 'rotate-180' : ''}`}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          <AnimatePresence>
            {showAccess && (
              <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                <div className="px-4 pb-3">
                  <p className="text-xs text-amber-800 bg-amber-50 rounded-lg p-3 leading-relaxed">{accessInstructions}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ── Content ── */}
      {checklistsLoading || !editorInitialized ? (
        <div className="flex-1 flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin text-text-tertiary">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          </svg>
        </div>
      ) : activeChecklist ? (
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          <ChecklistBuilder
            key={activeChecklist.id}
            sections={editorSections}
            onChange={setEditorSections}
            initialName={activeChecklist.name}
            initialIsDefault={activeChecklist.is_default}
            mode="client-profile"
            saving={saving}
            onSave={handleSave}
            onSaveAsNew={handleSaveAsNew}
            onCancel={onClose}
          />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-tertiary mx-auto mb-3">
              <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
              <rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/>
            </svg>
            <p className="text-sm text-text-secondary font-medium">No checklist for this client</p>
            <p className="text-xs text-text-tertiary mt-1">Add one from the Checklists tab.</p>
          </div>
        </div>
      )}
    </div>
  );
}
