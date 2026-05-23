'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/hooks/useAuth';
import { useClients, SavedClient } from '@/lib/hooks/useClients';
import { createClient as createSupabaseClient } from '@/lib/supabase/client';
import { ChecklistSection, migrateOldSection } from '@/components/checklist/types';
import ChecklistBuilder from '@/components/checklist/ChecklistBuilder';

type ClientChecklist = {
  id: string;
  client_id: string;
  name: string;
  is_default: boolean;
  sections: unknown[];
  created_at: string;
  updated_at: string;
};

type Completion = {
  id: string;
  checklist_id: string;
  client_id: string;
  status: string;
  submitted_at: string | null;
  pre_fill: { staff_name?: string; date?: string } | null;
  created_at: string;
};

export default function ChecklistsPage() {
  const { profile } = useAuth();
  const orgId = profile?.org_id || null;
  const supabase = useMemo(() => createSupabaseClient(), []);

  const { clients } = useClients(orgId);

  // ── Data ───────────────────────────────────────────────────────────────────
  const [checklists, setChecklists] = useState<ClientChecklist[]>([]);
  const [completions, setCompletions] = useState<Completion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    Promise.all([
      supabase.from('client_checklists').select('*').eq('org_id', orgId).order('updated_at', { ascending: false }),
      supabase.from('checklist_completions').select('id,checklist_id,client_id,status,submitted_at,pre_fill,created_at').eq('org_id', orgId).order('created_at', { ascending: false }).limit(200),
    ]).then(([{ data: cls }, { data: comps }]) => {
      setChecklists((cls || []) as ClientChecklist[]);
      setCompletions((comps || []) as Completion[]);
      setLoading(false);
    });
  }, [orgId, supabase]);

  // ── Left panel selection ───────────────────────────────────────────────────
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState('');

  const filteredClients = useMemo(() =>
    clients.filter(c => !clientSearch || c.name.toLowerCase().includes(clientSearch.toLowerCase())),
    [clients, clientSearch]
  );

  const selectedClient = useMemo(() =>
    clients.find(c => c.id === selectedClientId) ?? null,
    [clients, selectedClientId]
  );

  // Auto-select first client once loaded
  useEffect(() => {
    if (!selectedClientId && clients.length > 0) {
      setSelectedClientId(clients[0].id);
    }
  }, [clients, selectedClientId]);

  // ── Right panel: checklists for selected client ────────────────────────────
  const clientChecklists = useMemo(() =>
    checklists.filter(cl => cl.client_id === selectedClientId),
    [checklists, selectedClientId]
  );

  // Which checklist is being viewed / edited
  const [activeChecklistId, setActiveChecklistId] = useState<string | 'new' | null>(null);
  const [builderSections, setBuilderSections] = useState<ChecklistSection[]>([]);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  // Reset active checklist when client changes
  useEffect(() => {
    setActiveChecklistId(null);
    setBuilderSections([]);
  }, [selectedClientId]);

  const activeChecklist = useMemo(() =>
    activeChecklistId && activeChecklistId !== 'new'
      ? clientChecklists.find(cl => cl.id === activeChecklistId) ?? null
      : null,
    [activeChecklistId, clientChecklists]
  );

  const openNew = useCallback(() => {
    setBuilderSections([{ id: crypto.randomUUID(), title: '', fields: [] }]);
    setActiveChecklistId('new');
  }, []);

  const openEdit = useCallback((cl: ClientChecklist) => {
    const migrated = (cl.sections as Record<string, unknown>[]).map(s => migrateOldSection(s));
    setBuilderSections(migrated);
    setActiveChecklistId(cl.id);
  }, []);

  // ── Save handlers ──────────────────────────────────────────────────────────
  const handleSave = async (name: string, sections: ChecklistSection[], isDefault: boolean) => {
    if (!orgId || !selectedClientId) return;
    setSaving(true);

    if (activeChecklistId === 'new') {
      const { data } = await supabase
        .from('client_checklists')
        .insert({ org_id: orgId, client_id: selectedClientId, name, sections, is_default: isDefault })
        .select('*').single() as { data: ClientChecklist | null };
      if (data) {
        setChecklists(prev => [data, ...prev]);
        if (isDefault) setChecklists(prev => prev.map(c => c.client_id === selectedClientId && c.id !== data.id ? { ...c, is_default: false } : c));
        setActiveChecklistId(data.id);
      }
    } else if (activeChecklistId) {
      await supabase.from('client_checklists')
        .update({ name, sections, is_default: isDefault, updated_at: new Date().toISOString() })
        .eq('id', activeChecklistId);
      setChecklists(prev => prev.map(c => {
        if (c.id === activeChecklistId) return { ...c, name, sections: sections as unknown[], is_default: isDefault };
        if (isDefault && c.client_id === selectedClientId) return { ...c, is_default: false };
        return c;
      }));
    }

    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this checklist?')) return;
    await supabase.from('client_checklists').delete().eq('id', id);
    setChecklists(prev => prev.filter(c => c.id !== id));
    if (activeChecklistId === id) { setActiveChecklistId(null); setBuilderSections([]); }
  };

  const handleSetDefault = async (id: string) => {
    await supabase.from('client_checklists').update({ is_default: false }).eq('client_id', selectedClientId ?? '');
    await supabase.from('client_checklists').update({ is_default: true }).eq('id', id);
    setChecklists(prev => prev.map(c => c.client_id === selectedClientId ? { ...c, is_default: c.id === id } : c));
  };

  const downloadPDF = async (comp: Completion) => {
    setDownloading(comp.id);
    const res = await fetch(`/api/checklist/pdf?completion_id=${comp.id}`);
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `checklist_${comp.id}.pdf`; a.click();
      URL.revokeObjectURL(url);
    }
    setDownloading(null);
  };

  const completionsFor = (clId: string) => completions.filter(c => c.checklist_id === clId);

  return (
    <div className="h-full flex overflow-hidden">

      {/* ══════════════════════════════════════════════════════════════════════
          LEFT PANEL — Client list
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="w-64 shrink-0 flex flex-col border-r border-border-light bg-surface-elevated/40">
        {/* Search */}
        <div className="shrink-0 p-3 border-b border-border-light">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              value={clientSearch}
              onChange={e => setClientSearch(e.target.value)}
              placeholder="Search clients…"
              className="input-field text-sm w-full pl-8 py-2"
            />
          </div>
        </div>

        {/* Client list */}
        <div className="flex-1 overflow-y-auto custom-scrollbar py-1">
          {filteredClients.length === 0 ? (
            <p className="text-xs text-text-tertiary text-center py-8 px-4">No clients yet</p>
          ) : (
            filteredClients.map(client => {
              const count = checklists.filter(cl => cl.client_id === client.id).length;
              const isSelected = selectedClientId === client.id;
              return (
                <button
                  key={client.id}
                  onClick={() => setSelectedClientId(client.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left ${isSelected ? 'bg-primary/8 border-r-2 border-primary' : 'hover:bg-surface-elevated'}`}
                >
                  {/* Avatar */}
                  <div
                    className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-xs font-bold shrink-0"
                    style={{ backgroundColor: client.color || '#6366f1' }}
                  >
                    {client.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold truncate ${isSelected ? 'text-primary' : 'text-text-primary'}`}>
                      {client.name}
                    </p>
                    <p className="text-[11px] text-text-tertiary">
                      {count} checklist{count !== 1 ? 's' : ''}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          RIGHT PANEL — Checklists for selected client
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {!selectedClient ? (
          <div className="flex-1 flex items-center justify-center text-center px-6">
            <div>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-tertiary mx-auto mb-3">
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
                <rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/>
              </svg>
              <p className="text-sm text-text-secondary font-semibold">Select a client</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* ── Right header ── */}
            <div className="shrink-0 flex items-center gap-3 px-5 py-3.5 border-b border-border-light bg-white">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-bold shrink-0"
                style={{ backgroundColor: selectedClient.color || '#6366f1' }}
              >
                {selectedClient.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-bold text-text-primary truncate">{selectedClient.name}</h2>
                <p className="text-[11px] text-text-tertiary">
                  {clientChecklists.length} checklist{clientChecklists.length !== 1 ? 's' : ''}
                  {activeChecklistId === 'new' ? ' · Creating new' : activeChecklist ? ` · Editing "${activeChecklist.name}"` : ''}
                </p>
              </div>
              {/* New checklist button */}
              {activeChecklistId !== 'new' && (
                <button onClick={openNew} className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5 shrink-0">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  New Checklist
                </button>
              )}
            </div>

            {/* ── Main content: split into checklist list + builder ── */}
            <div className="flex-1 flex min-h-0 overflow-hidden">

              {/* Checklist list — left of right panel */}
              <div className="w-56 shrink-0 flex flex-col border-r border-border-light bg-white overflow-y-auto custom-scrollbar">
                {loading ? (
                  <div className="p-3 space-y-2">
                    {[1,2,3].map(i => <div key={i} className="shimmer h-14 rounded-xl"/>)}
                  </div>
                ) : clientChecklists.length === 0 && activeChecklistId !== 'new' ? (
                  <div className="flex flex-col items-center justify-center h-full text-center px-4 py-8">
                    <p className="text-xs text-text-tertiary">No checklists yet</p>
                    <button onClick={openNew} className="mt-3 text-xs font-semibold text-primary hover:text-primary/80 transition-colors">
                      + Create one
                    </button>
                  </div>
                ) : (
                  <div className="py-1">
                    {/* New (unsaved) entry */}
                    {activeChecklistId === 'new' && (
                      <div className="flex items-center gap-2 px-3 py-2.5 bg-primary/8 border-r-2 border-primary">
                        <div className="w-2 h-2 rounded-full bg-primary shrink-0"/>
                        <span className="text-xs font-semibold text-primary truncate flex-1">New checklist</span>
                      </div>
                    )}
                    {clientChecklists.map(cl => {
                      const comps = completionsFor(cl.id);
                      const submitted = comps.filter(c => c.status === 'submitted').length;
                      const isActive = activeChecklistId === cl.id;
                      return (
                        <div key={cl.id}>
                          <button
                            onClick={() => openEdit(cl)}
                            className={`w-full flex items-center gap-2.5 px-3 py-2.5 transition-colors text-left ${isActive ? 'bg-primary/8 border-r-2 border-primary' : 'hover:bg-surface-elevated'}`}
                          >
                            <div className={`w-2 h-2 rounded-full shrink-0 ${cl.is_default ? 'bg-primary' : 'bg-border-light'}`}/>
                            <div className="flex-1 min-w-0">
                              <p className={`text-xs font-semibold truncate ${isActive ? 'text-primary' : 'text-text-primary'}`}>{cl.name}</p>
                              <p className="text-[10px] text-text-tertiary">
                                {cl.is_default && 'Default · '}{submitted} submitted
                              </p>
                            </div>
                          </button>
                          {/* Submissions under this checklist */}
                          {isActive && comps.length > 0 && (
                            <div className="bg-slate-50 border-t border-border-light/50 px-3 py-2 space-y-1.5">
                              <p className="text-[9px] font-bold text-text-tertiary uppercase tracking-wider mb-1">Submissions</p>
                              {comps.slice(0, 5).map(comp => (
                                <div key={comp.id} className="flex items-center gap-2">
                                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${comp.status === 'submitted' ? 'bg-emerald-500' : 'bg-amber-400'}`}/>
                                  <p className="text-[10px] text-text-secondary flex-1 truncate">
                                    {comp.pre_fill?.staff_name || 'Staff'} · {comp.pre_fill?.date || new Date(comp.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                                  </p>
                                  {comp.status === 'submitted' && (
                                    <button
                                      onClick={e => { e.stopPropagation(); downloadPDF(comp); }}
                                      disabled={downloading === comp.id}
                                      className="text-[10px] font-semibold text-primary hover:text-primary/70 disabled:opacity-40 shrink-0"
                                    >
                                      {downloading === comp.id ? '…' : 'PDF'}
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Builder / empty state */}
              <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
                <AnimatePresence mode="wait">
                  {activeChecklistId ? (
                    <motion.div
                      key={activeChecklistId}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex-1 flex flex-col min-h-0 overflow-hidden"
                    >
                      {/* Checklist actions bar (for existing checklists) */}
                      {activeChecklist && (
                        <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-slate-50/60 border-b border-border-light">
                          {!activeChecklist.is_default && (
                            <button
                              onClick={() => handleSetDefault(activeChecklist.id)}
                              className="text-xs font-semibold text-text-tertiary hover:text-primary transition-colors px-2 py-1 rounded-lg hover:bg-primary/5"
                            >
                              Set as Default
                            </button>
                          )}
                          {activeChecklist.is_default && (
                            <span className="text-xs font-semibold text-primary px-2 py-1">✓ Default</span>
                          )}
                          <div className="flex-1"/>
                          <button
                            onClick={() => handleDelete(activeChecklist.id)}
                            className="text-xs font-semibold text-text-tertiary hover:text-rose-500 transition-colors px-2 py-1 rounded-lg hover:bg-rose-50"
                          >
                            Delete
                          </button>
                        </div>
                      )}

                      <div className="flex-1 min-h-0 overflow-hidden">
                        <ChecklistBuilder
                          sections={builderSections}
                          onChange={setBuilderSections}
                          initialName={activeChecklist?.name ?? ''}
                          initialIsDefault={activeChecklist?.is_default ?? (clientChecklists.length === 0)}
                          mode="client-profile"
                          saving={saving}
                          onSave={handleSave}
                          onCancel={activeChecklistId === 'new' ? () => { setActiveChecklistId(null); setBuilderSections([]); } : undefined}
                        />
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="empty"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex-1 flex items-center justify-center text-center px-8"
                    >
                      <div>
                        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-tertiary mx-auto mb-3">
                          <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
                          <rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/>
                        </svg>
                        <p className="text-sm font-semibold text-text-secondary mb-1">
                          {clientChecklists.length > 0 ? 'Select a checklist to edit' : 'No checklists yet'}
                        </p>
                        <p className="text-xs text-text-tertiary mb-4">
                          {clientChecklists.length > 0
                            ? 'Choose one from the list, or create a new one'
                            : `Create the first checklist for ${selectedClient.name}`}
                        </p>
                        <button onClick={openNew} className="btn-primary text-xs py-2 px-4">
                          + New Checklist
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
