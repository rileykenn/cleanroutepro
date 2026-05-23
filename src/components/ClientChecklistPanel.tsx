'use client';

/**
 * ClientChecklistPanel
 *
 * Right-panel component shown in the Schedule day view when clicking
 * the clipboard icon on a job card. Wraps the universal ChecklistBuilder
 * component in compact mode.
 *
 * Handles:
 * - Loading the right checklist for the client (uses default or job-linked one)
 * - Access instructions accordion
 * - Saving completions to the DB + realtime subscription for live tracking
 * - Admin can switch between builder/completion modes
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient as createSupabaseClient } from '@/lib/supabase/client';
import { useClientChecklists } from '@/lib/hooks/useClientChecklists';
import {
  Client, ClientChecklist, ChecklistSection, ChecklistCompletion, FieldAnswer,
} from '@/lib/types';
import ChecklistBuilder from '@/components/checklist/ChecklistBuilder';

interface ClientChecklistPanelProps {
  client: Client;
  orgId: string;
  isAdmin: boolean;
  scheduleJobId: string;
  scheduleJobDbId?: string;
  onClose: () => void;
  onLinkChecklist?: (clientId: string, checklistId: string | null) => void;
  onSaveJobOnly?: (clientId: string, override: ChecklistSection[]) => void;
}

export default function ClientChecklistPanel({
  client, orgId, isAdmin, scheduleJobId, scheduleJobDbId, onClose, onLinkChecklist, onSaveJobOnly,
}: ClientChecklistPanelProps) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const { checklists, defaultChecklist, loading, addChecklist, updateChecklist } = useClientChecklists(client.savedClientId || null, orgId);

  // Which checklist is active
  const [activeId, setActiveId] = useState<string | null>(client.checklistId || null);
  const [editorMode, setEditorMode] = useState<'completion' | 'builder'>('completion');
  const [showAccess, setShowAccess] = useState(false);
  const [accessInstructions, setAccessInstructions] = useState('');
  const [completion, setCompletion] = useState<ChecklistCompletion | null>(null);
  const [userName, setUserName] = useState('');

  const activeChecklist = useMemo(() =>
    checklists.find(c => c.id === activeId) || defaultChecklist,
    [checklists, activeId, defaultChecklist]
  );

  // Set active from default when checklists load
  useEffect(() => {
    if (!activeId && defaultChecklist) setActiveId(defaultChecklist.id);
    if (client.checklistId) setActiveId(client.checklistId);
  }, [activeId, defaultChecklist, client.checklistId]);

  // Load access instructions
  useEffect(() => {
    if (!client.savedClientId) return;
    supabase.from('clients').select('access_instructions').eq('id', client.savedClientId).single()
      .then(({ data }: { data: { access_instructions: string | null } | null }) => {
        if (data) setAccessInstructions(data.access_instructions || '');
      });
  }, [client.savedClientId, supabase]);

  // Load completion record
  useEffect(() => {
    if (!scheduleJobDbId) return;
    supabase.from('checklist_completions')
      .select('*').eq('schedule_job_id', scheduleJobDbId).maybeSingle()
      .then(({ data }: { data: ChecklistCompletion | null }) => {
        if (data) setCompletion(data);
      });
  }, [scheduleJobDbId, supabase]);

  // Realtime subscription
  useEffect(() => {
    if (!scheduleJobDbId) return;
    const channel = supabase
      .channel(`completion-${scheduleJobDbId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'checklist_completions',
        filter: `schedule_job_id=eq.${scheduleJobDbId}`,
      }, (payload: { new: ChecklistCompletion | null }) => {
        if (payload.new) setCompletion(payload.new);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [scheduleJobDbId, supabase]);

  // Current user name for completion records
  useEffect(() => {
    supabase.auth.getUser().then(({ data }: { data: { user: { id: string } | null } }) => {
      if (data?.user) {
        supabase.from('profiles').select('full_name').eq('id', data.user.id).single()
          .then(({ data: p }: { data: { full_name: string } | null }) => { if (p) setUserName(p.full_name || ''); });
      }
    });
  }, [supabase]);

  const handleSubmit = useCallback(async (answers: FieldAnswer[], notes: string) => {
    if (!client.savedClientId) return;
    const now = new Date().toISOString();
    const row = {
      org_id: orgId,
      client_id: client.savedClientId,
      schedule_job_id: scheduleJobDbId || null,
      checklist_id: activeChecklist?.id || null,
      items: answers,
      notes,
      completed_by: userName,
      completed_at: now,
      submitted: true,
    };
    if (completion?.id) {
      await supabase.from('checklist_completions').update(row).eq('id', completion.id);
    } else {
      const { data } = await supabase.from('checklist_completions').insert(row).select('*').single();
      if (data) setCompletion(data as ChecklistCompletion);
    }
  }, [orgId, client.savedClientId, scheduleJobDbId, activeChecklist, userName, completion, supabase]);

  const handleAutoSave = useCallback(async (answers: FieldAnswer[]) => {
    if (!client.savedClientId || !scheduleJobDbId) return;
    const now = new Date().toISOString();
    const row = {
      org_id: orgId,
      client_id: client.savedClientId,
      schedule_job_id: scheduleJobDbId,
      checklist_id: activeChecklist?.id || null,
      items: answers,
      notes: completion?.notes || '',
      completed_by: userName,
      completed_at: now,
      submitted: false,
    };
    if (completion?.id) {
      await supabase.from('checklist_completions').update(row).eq('id', completion.id);
    } else {
      const { data } = await supabase.from('checklist_completions').insert(row).select('*').single();
      if (data) setCompletion(data as ChecklistCompletion);
    }
  }, [orgId, client.savedClientId, scheduleJobDbId, activeChecklist, userName, completion, supabase]);

  const cardColor = client.clientColor || '#6366f1';

  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col h-full bg-white rounded-2xl border border-border-light overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border-light bg-surface-elevated shrink-0">
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary hover:text-text-primary transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div className="w-6 h-6 rounded-lg shrink-0 flex items-center justify-center text-white text-[10px] font-bold" style={{ backgroundColor: cardColor }}>
          {client.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-text-primary truncate">{client.name}</p>
          <p className="text-[10px] text-text-tertiary">Checklist</p>
        </div>

        {/* Checklist selector */}
        {checklists.length > 1 && (
          <select
            value={activeId || ''}
            onChange={e => { setActiveId(e.target.value); if (onLinkChecklist) onLinkChecklist(client.id, e.target.value || null); }}
            className="text-xs bg-white border border-border-light rounded-lg px-2 py-1.5 outline-none max-w-[130px] truncate"
          >
            {checklists.map(cl => (
              <option key={cl.id} value={cl.id}>{cl.name}{cl.is_default ? ' ✓' : ''}</option>
            ))}
          </select>
        )}
        {checklists.length === 1 && (
          <span className="text-xs font-medium text-text-secondary bg-surface-elevated px-2 py-1 rounded-lg truncate max-w-[120px]">{checklists[0].name}</span>
        )}

        {/* Mode toggle (admin only) */}
        {isAdmin && checklists.length > 0 && (
          <button
            onClick={() => setEditorMode(m => m === 'completion' ? 'builder' : 'completion')}
            className={`p-1.5 rounded-lg transition-colors shrink-0 ${editorMode === 'builder' ? 'bg-primary text-white' : 'hover:bg-surface-elevated text-text-tertiary hover:text-primary'}`}
            title={editorMode === 'builder' ? 'Switch to completion mode' : 'Edit checklist structure'}
          >
            {editorMode === 'builder' ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            )}
          </button>
        )}
      </div>

      {/* No checklist */}
      {!loading && checklists.length === 0 && (
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <div>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-tertiary mx-auto mb-3">
              <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
              <rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/>
            </svg>
            <p className="text-sm font-semibold text-text-primary mb-1">No checklist set up</p>
            <p className="text-xs text-text-tertiary">Go to the client's profile in the Clients tab to create checklists.</p>
          </div>
        </div>
      )}

      {/* Access instructions accordion */}
      {accessInstructions && (
        <div className="border-b border-border-light shrink-0">
          <button
            onClick={() => setShowAccess(!showAccess)}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-surface-elevated transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-500 shrink-0">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
            </svg>
            <span className="text-xs font-semibold text-amber-700 flex-1">Access Instructions</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`text-text-tertiary transition-transform ${showAccess ? 'rotate-180' : ''}`}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          <AnimatePresence>
            {showAccess && (
              <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                <div className="px-4 pb-3 pt-0">
                  <p className="text-xs text-text-secondary bg-amber-50 rounded-xl p-3 leading-relaxed whitespace-pre-wrap border border-amber-100">{accessInstructions}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ChecklistBuilder */}
      {!loading && checklists.length > 0 && activeChecklist && (
        <div className="flex-1 overflow-hidden p-3">
          <ChecklistBuilder
            mode={editorMode}
            checklist={activeChecklist}
            completion={editorMode === 'completion' ? completion : null}
            orgId={orgId}
            compact={true}
            onSubmit={handleSubmit}
            onAutoSave={handleAutoSave}
            onSaveTemplate={async ({ name, sections }) => {
              await updateChecklist(activeChecklist.id, { name, sections, is_default: activeChecklist.is_default });
            }}
            onSaveAsNew={async (name, sections) => {
              const newCl = await addChecklist(name, sections, false);
              if (newCl && onLinkChecklist) onLinkChecklist(client.id, newCl.id);
              return newCl;
            }}
            onSaveJobOnly={sections => {
              if (onSaveJobOnly) onSaveJobOnly(client.id, sections);
              if (scheduleJobDbId) {
                supabase.from('schedule_jobs').update({ checklist_override: sections }).eq('id', scheduleJobDbId);
              }
            }}
            showJobActions={true}
          />
        </div>
      )}

      {loading && (
        <div className="flex-1 p-4 space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="shimmer h-12 rounded-xl" />)}
        </div>
      )}
    </motion.div>
  );
}
