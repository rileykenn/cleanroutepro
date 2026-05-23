'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SupabaseClient } from '@supabase/supabase-js';

import { Client } from '@/lib/types';
import { ChecklistSection, migrateOldSection, PreFillMeta } from '@/components/checklist/types';
import { useClientChecklists } from '@/lib/hooks/useClientChecklists';
import { useChecklistCompletion } from '@/lib/hooks/useChecklistCompletion';
import ChecklistRunner from '@/components/checklist/ChecklistRunner';
import { createClient as createSupabaseClient } from '@/lib/supabase/client';

interface ClientChecklistPanelProps {
  client: Client;
  orgId: string;
  isAdmin?: boolean;
  scheduleJobId?: string;
  onClose: () => void;
  preFill?: PreFillMeta;
}

export default function ClientChecklistPanel({
  client, orgId, isAdmin = false, scheduleJobId,
  onClose, preFill,
}: ClientChecklistPanelProps) {
  const supabase: SupabaseClient = useMemo(() => createSupabaseClient(), []);

  const savedClientId = client.savedClientId || '';
  const { checklists, defaultChecklist, loading: checklistsLoading } = useClientChecklists(
    savedClientId || null,
    orgId,
  );

  const [activeChecklistId, setActiveChecklistId] = useState<string | null>(null);

  const activeChecklist = useMemo(() => {
    if (client.checklistOverride) {
      return {
        id: '__override__',
        name: 'Custom (this job only)',
        sections: (client.checklistOverride as unknown[]).map(s => migrateOldSection(s as Record<string, unknown>)),
        is_default: false,
      };
    }
    if (activeChecklistId) return checklists.find(c => c.id === activeChecklistId) || null;
    if (client.checklistId) return checklists.find(c => c.id === client.checklistId) || null;
    return defaultChecklist || null;
  }, [client.checklistOverride, client.checklistId, activeChecklistId, checklists, defaultChecklist]);

  const activeSections: ChecklistSection[] = useMemo(() => {
    if (!activeChecklist) return [];
    return activeChecklist.sections.map(s => migrateOldSection(s as unknown as Record<string, unknown>));
  }, [activeChecklist]);

  // Completion hook
  const { completionId, responses, status, saving: autoSaving, handleResponseChange, submit } = useChecklistCompletion({
    supabase,
    orgId,
    clientId: savedClientId,
    checklistId: activeChecklist?.id && activeChecklist.id !== '__override__' ? activeChecklist.id : null,
    scheduleJobId: scheduleJobId || null,
    preFill,
  });

  // Access instructions
  const [accessInstructions, setAccessInstructions] = useState<string | null>(null);
  const [showAccess, setShowAccess] = useState(false);
  useMemo(() => {
    if (!savedClientId) return;
    supabase.from('clients').select('access_instructions').eq('id', savedClientId).single()
      .then(({ data }: { data: { access_instructions: string | null } | null }) => {
        setAccessInstructions(data?.access_instructions || null);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedClientId]);

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

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-border-light">
        <button onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-surface-elevated text-text-tertiary hover:text-text-primary transition-colors shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>

        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-text-primary truncate">{client.name}</h2>
          {activeChecklist && (
            <p className="text-[11px] text-text-tertiary truncate">{activeChecklist.name}</p>
          )}
        </div>

        {/* Checklist selector — only when client has multiple */}
        {checklists.length > 1 && (
          <select
            value={activeChecklistId || activeChecklist?.id || ''}
            onChange={e => setActiveChecklistId(e.target.value)}
            className="input-field text-xs py-1.5 max-w-[130px]"
          >
            {checklists.map(cl => (
              <option key={cl.id} value={cl.id}>{cl.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* ── Access instructions accordion ────────────────────────────────────── */}
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

      {/* ── Content ──────────────────────────────────────────────────────────── */}
      {checklistsLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin text-text-tertiary">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          </svg>
        </div>
      ) : activeSections.length > 0 ? (
        <div className="flex-1 min-h-0">
          <ChecklistRunner
            sections={activeSections}
            responses={responses}
            onChange={handleResponseChange}
            onSubmit={submit}
            orgId={orgId}
            completionId={completionId}
            preFilledMeta={preFill}
            isAdmin={isAdmin}
            readOnly={status === 'submitted'}
            saving={autoSaving}
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
            <p className="text-xs text-text-tertiary mt-1">Add one from the client's profile.</p>
          </div>
        </div>
      )}
    </div>
  );
}
