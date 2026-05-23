'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient as createSupabaseClient } from '@/lib/supabase/client';
import { useClientChecklists } from '@/lib/hooks/useClientChecklists';
import {
  Client, ClientChecklist, ChecklistSection, ChecklistItem,
  ChecklistItemCompletion, ChecklistCompletion,
} from '@/lib/types';
import { generateId } from '@/lib/timeUtils';

interface ClientChecklistPanelProps {
  client: Client;
  orgId: string;
  isAdmin: boolean;
  scheduleJobId: string;       // the schedule_jobs.id for this scheduled job
  scheduleJobDbId?: string;    // actual DB uuid (may differ from local state id)
  onClose: () => void;
  onLinkChecklist?: (clientId: string, checklistId: string | null) => void;
  onSaveJobOnly?: (clientId: string, override: ChecklistSection[]) => void;
}

// ─── Name prompt modal ────────────────────────────────────────────────────────
function NamePrompt({ onConfirm, onCancel }: { onConfirm: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50); }, []);
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm"
      >
        <h3 className="text-sm font-bold text-text-primary mb-1">Name this checklist</h3>
        <p className="text-xs text-text-secondary mb-4">It will be saved to this client's profile for future use.</p>
        <input
          ref={inputRef}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onConfirm(name.trim()); if (e.key === 'Escape') onCancel(); }}
          placeholder="e.g. Deep Clean, End of Lease…"
          className="input-field text-sm w-full mb-4"
        />
        <div className="flex gap-2">
          <button
            onClick={() => { if (name.trim()) onConfirm(name.trim()); }}
            disabled={!name.trim()}
            className="btn-primary text-sm flex-1 disabled:opacity-50"
          >Save</button>
          <button onClick={onCancel} className="btn-ghost text-sm px-4">Cancel</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function ClientChecklistPanel({
  client, orgId, isAdmin, scheduleJobId, scheduleJobDbId, onClose, onLinkChecklist, onSaveJobOnly,
}: ClientChecklistPanelProps) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const { checklists, defaultChecklist, loading, addChecklist, updateChecklist } = useClientChecklists(client.savedClientId || null, orgId);

  // Which checklist is active (linked to this job or default)
  const [activeId, setActiveId] = useState<string | null>(client.checklistId || null);
  const [workingSections, setWorkingSections] = useState<ChecklistSection[]>([]);
  const [showAccess, setShowAccess] = useState(false);
  const [accessInstructions, setAccessInstructions] = useState('');
  const [showNamePrompt, setShowNamePrompt] = useState<'save-new' | null>(null);
  const [saving, setSaving] = useState(false);
  const [completion, setCompletion] = useState<ChecklistItemCompletion[]>([]);
  const [completionDbId, setCompletionDbId] = useState<string | null>(null);
  const [userName, setUserName] = useState('');

  // Resolve active checklist object
  const activeChecklist = useMemo(() =>
    checklists.find(c => c.id === activeId) || defaultChecklist,
    [checklists, activeId, defaultChecklist]
  );

  // Load access instructions
  useEffect(() => {
    if (!client.savedClientId) return;
    supabase.from('clients').select('access_instructions').eq('id', client.savedClientId).single()
      .then(({ data }: { data: { access_instructions: string | null } | null }) => { if (data) setAccessInstructions(data.access_instructions || ''); });
  }, [client.savedClientId, supabase]);

  // Sync working sections when active checklist changes
  useEffect(() => {
    const source = client.checklistOverride || activeChecklist?.sections || [];
    setWorkingSections(JSON.parse(JSON.stringify(source)));
  }, [activeChecklist, client.checklistOverride]);

  // Set active checklist from client.checklistId once checklists load
  useEffect(() => {
    if (!activeId && defaultChecklist) setActiveId(defaultChecklist.id);
    if (client.checklistId) setActiveId(client.checklistId);
  }, [activeId, defaultChecklist, client.checklistId]);

  // Fetch current completion record for this job
  useEffect(() => {
    if (!scheduleJobDbId) return;
    supabase.from('checklist_completions')
      .select('*').eq('schedule_job_id', scheduleJobDbId).maybeSingle()
      .then(({ data }: { data: ChecklistCompletion | null }) => {
        if (data) {
          setCompletion(data.items || []);
          setCompletionDbId(data.id);
        }
      });
  }, [scheduleJobDbId, supabase]);

  // Realtime: watch for completion updates (so owner sees staff ticking live)
  useEffect(() => {
    if (!scheduleJobDbId) return;
    const channel = supabase
      .channel(`completion-${scheduleJobDbId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'checklist_completions',
        filter: `schedule_job_id=eq.${scheduleJobDbId}`,
      }, (payload: { new: ChecklistCompletion | null }) => {
        if (payload.new) {
          const row = payload.new;
          setCompletion(row.items || []);
          setCompletionDbId(row.id);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [scheduleJobDbId, supabase]);

  // Get current user name for completions
  useEffect(() => {
    supabase.auth.getUser().then(({ data }: { data: { user: { id: string } | null } }) => {
      if (data?.user) {
        supabase.from('profiles').select('full_name').eq('id', data.user.id).single()
          .then(({ data: p }: { data: { full_name: string } | null }) => { if (p) setUserName(p.full_name || ''); });
      }
    });
  }, [supabase]);

  const getItemCompletion = (itemId: string) =>
    completion.find(c => c.item_id === itemId);

  const toggleItem = useCallback(async (itemId: string) => {
    const current = getItemCompletion(itemId);
    const newChecked = !current?.checked;
    const now = new Date().toISOString();

    const newCompletion: ChecklistItemCompletion[] = workingSections.flatMap(s => s.items).map(item => {
      const ex = completion.find(c => c.item_id === item.id);
      if (item.id === itemId) return { item_id: item.id, checked: newChecked, checked_by_name: newChecked ? userName : undefined, checked_at: newChecked ? now : undefined };
      return ex || { item_id: item.id, checked: false };
    });

    setCompletion(newCompletion);

    if (!scheduleJobDbId || !client.savedClientId) return;

    if (completionDbId) {
      await supabase.from('checklist_completions').update({ items: newCompletion, completed_at: now })
        .eq('id', completionDbId);
    } else {
      const { data } = await supabase.from('checklist_completions').insert({
        org_id: orgId, client_id: client.savedClientId,
        schedule_job_id: scheduleJobDbId,
        checklist_id: activeChecklist?.id || null,
        items: newCompletion,
        completed_at: now,
      }).select('id').single();
      if (data) setCompletionDbId((data as { id: string }).id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completion, workingSections, scheduleJobDbId, completionDbId, orgId, client.savedClientId, activeChecklist, userName, supabase]);

  const totalItems = workingSections.reduce((sum, s) => sum + s.items.length, 0);
  const checkedItems = completion.filter(c => c.checked).length;
  const progressPct = totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0;

  // ─── Admin editing helpers ──────────────────────────────────────────────────
  const addSection = () => setWorkingSections(s => [...s, { id: generateId(), title: '', items: [] }]);
  const removeSection = (sid: string) => setWorkingSections(s => s.filter(x => x.id !== sid));
  const updateSection = (sid: string, title: string) => setWorkingSections(s => s.map(x => x.id === sid ? { ...x, title } : x));
  const addItem = (sid: string) => setWorkingSections(s => s.map(x => x.id === sid ? { ...x, items: [...x.items, { id: generateId(), text: '', required: false }] } : x));
  const removeItem = (sid: string, iid: string) => setWorkingSections(s => s.map(x => x.id === sid ? { ...x, items: x.items.filter(i => i.id !== iid) } : x));
  const updateItem = (sid: string, iid: string, patch: Partial<ChecklistItem>) => setWorkingSections(s => s.map(x => x.id === sid ? { ...x, items: x.items.map(i => i.id === iid ? { ...i, ...patch } : i) } : x));

  const handleSaveChanges = async () => {
    if (!activeChecklist) return;
    setSaving(true);
    await updateChecklist(activeChecklist.id, { sections: workingSections });
    setSaving(false);
  };

  const handleSaveAsNew = async (name: string) => {
    setSaving(true);
    const newCl = await addChecklist(name, workingSections, false);
    if (newCl && onLinkChecklist) onLinkChecklist(client.id, newCl.id);
    setShowNamePrompt(null);
    setSaving(false);
  };

  const handleSaveJobOnly = async () => {
    if (onSaveJobOnly) onSaveJobOnly(client.id, workingSections);
    // Persist override to schedule_jobs row
    if (scheduleJobDbId) {
      await supabase.from('schedule_jobs').update({ checklist_override: workingSections }).eq('id', scheduleJobDbId);
    }
  };

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
            className="text-xs bg-white border border-border-light rounded-lg px-2 py-1.5 outline-none max-w-[140px] truncate"
          >
            {checklists.map(cl => (
              <option key={cl.id} value={cl.id}>{cl.name}{cl.is_default ? ' (Default)' : ''}</option>
            ))}
          </select>
        )}
        {checklists.length === 1 && (
          <span className="text-xs font-medium text-text-secondary bg-surface-elevated px-2 py-1 rounded-lg">{checklists[0].name}</span>
        )}
      </div>

      {/* No checklist warning */}
      {!loading && checklists.length === 0 && (
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <div>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-tertiary mx-auto mb-3">
              <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
              <rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/>
            </svg>
            <p className="text-sm font-semibold text-text-primary mb-1">No checklist set up</p>
            <p className="text-xs text-text-tertiary">Go to the client's profile in the Clients tab to create checklists for this client.</p>
          </div>
        </div>
      )}

      {/* Progress bar */}
      {totalItems > 0 && (
        <div className="px-4 py-2.5 border-b border-border-light shrink-0">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-text-secondary font-medium">{checkedItems} / {totalItems} items complete</span>
            <span className={`text-xs font-bold ${progressPct === 100 ? 'text-emerald-600' : progressPct > 0 ? 'text-amber-600' : 'text-text-tertiary'}`}>{progressPct}%</span>
          </div>
          <div className="h-1.5 bg-surface-elevated rounded-full overflow-hidden">
            <motion.div
              className={`h-full rounded-full transition-all ${progressPct === 100 ? 'bg-emerald-500' : 'bg-primary'}`}
              style={{ width: `${progressPct}%` }}
              layout
            />
          </div>
        </div>
      )}

      {/* Access Instructions accordion */}
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

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
        {loading ? (
          <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="shimmer h-12 rounded-xl" />)}</div>
        ) : (
          workingSections.map((sec) => (
            <div key={sec.id} className="space-y-2">
              {/* Section title */}
              <div className="flex items-center gap-2">
                {isAdmin ? (
                  <input
                    value={sec.title}
                    onChange={e => updateSection(sec.id, e.target.value)}
                    placeholder="Section title…"
                    className="text-xs font-bold text-text-primary bg-transparent border-none outline-none flex-1 uppercase tracking-wider"
                  />
                ) : (
                  <h4 className="text-xs font-bold text-text-tertiary uppercase tracking-wider flex-1">{sec.title}</h4>
                )}
                {isAdmin && workingSections.length > 1 && (
                  <button onClick={() => removeSection(sec.id)} className="p-0.5 rounded hover:bg-danger-light text-text-tertiary hover:text-danger transition-colors">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                )}
              </div>

              {/* Items */}
              <div className="space-y-1.5 pl-1">
                {sec.items.map((item) => {
                  const comp = getItemCompletion(item.id);
                  return (
                    <div key={item.id} className="flex items-start gap-2.5">
                      {/* Checkbox — always interactive for all roles */}
                      <button
                        onClick={() => toggleItem(item.id)}
                        className={`mt-0.5 w-5 h-5 rounded-md border-2 shrink-0 flex items-center justify-center transition-all ${
                          comp?.checked
                            ? 'bg-emerald-500 border-emerald-500'
                            : 'border-border-light hover:border-primary'
                        }`}
                      >
                        {comp?.checked && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                      </button>

                      <div className="flex-1 min-w-0">
                        {isAdmin ? (
                          <input
                            value={item.text}
                            onChange={e => updateItem(sec.id, item.id, { text: e.target.value })}
                            className={`text-sm w-full bg-transparent border-none outline-none transition-colors ${comp?.checked ? 'line-through text-text-tertiary' : 'text-text-primary'}`}
                            placeholder="Checklist item…"
                          />
                        ) : (
                          <p className={`text-sm leading-snug transition-colors ${comp?.checked ? 'line-through text-text-tertiary' : 'text-text-primary'}`}>
                            {item.text}
                            {item.required && <span className="ml-1 text-[10px] text-red-400 font-bold">*</span>}
                          </p>
                        )}
                        {comp?.checked && comp.checked_by_name && (
                          <p className="text-[10px] text-text-tertiary mt-0.5">{comp.checked_by_name} · {comp.checked_at ? new Date(comp.checked_at).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) : ''}</p>
                        )}
                      </div>

                      {isAdmin && (
                        <button onClick={() => removeItem(sec.id, item.id)} className="p-0.5 rounded hover:bg-danger-light text-text-tertiary hover:text-danger transition-colors shrink-0">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        </button>
                      )}
                    </div>
                  );
                })}

                {isAdmin && (
                  <button onClick={() => addItem(sec.id)} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium transition-colors mt-1">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Add item
                  </button>
                )}
              </div>
            </div>
          ))
        )}

        {isAdmin && !loading && (
          <button onClick={addSection} className="w-full py-2 rounded-xl border-2 border-dashed border-border-light hover:border-primary text-xs text-text-tertiary hover:text-primary transition-colors font-medium">
            + Add Section
          </button>
        )}
      </div>

      {/* Admin save actions */}
      {isAdmin && !loading && checklists.length > 0 && (
        <div className="shrink-0 border-t border-border-light p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={handleSaveChanges} disabled={saving}
              className="btn-primary text-xs py-2 disabled:opacity-50 flex items-center justify-center gap-1.5">
              {saving
                ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
              }
              Save Changes
            </button>
            <button onClick={() => setShowNamePrompt('save-new')} disabled={saving}
              className="btn-ghost text-xs py-2 disabled:opacity-50 flex items-center justify-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              Save as New
            </button>
          </div>
          <button onClick={handleSaveJobOnly} disabled={saving}
            className="w-full text-xs text-text-tertiary hover:text-primary py-1.5 text-center transition-colors border border-border-light rounded-lg hover:border-primary hover:bg-primary-light/20">
            Save for this job only
          </button>
        </div>
      )}

      {/* Name prompt modal */}
      <AnimatePresence>
        {showNamePrompt === 'save-new' && (
          <NamePrompt onConfirm={handleSaveAsNew} onCancel={() => setShowNamePrompt(null)} />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
