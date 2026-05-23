'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/hooks/useAuth';
import { useClients } from '@/lib/hooks/useClients';
import { createClient as createSupabaseClient } from '@/lib/supabase/client';
import { ChecklistSection, migrateOldSection } from '@/components/checklist/types';
import ChecklistBuilder from '@/components/checklist/ChecklistBuilder';
import ClientProfileView from '@/components/ClientProfileView';

type ClientChecklist = {
  id: string;
  client_id: string;
  name: string;
  is_default: boolean;
  sections: unknown[];
  created_at: string;
  updated_at: string;
};

export default function ChecklistsPage() {
  const { profile } = useAuth();
  const orgId = profile?.org_id || null;
  const supabase = useMemo(() => createSupabaseClient(), []);

  const { clients } = useClients(orgId);

  // ── All checklists for this org ───────────────────────────────────────────
  const [allChecklists, setAllChecklists] = useState<ClientChecklist[]>([]);
  const [checklistsLoading, setChecklistsLoading] = useState(true);

  useEffect(() => {
    if (!orgId) return;
    supabase.from('client_checklists').select('*').eq('org_id', orgId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true })
      .then(({ data }: { data: ClientChecklist[] | null }) => {
        setAllChecklists((data || []) as ClientChecklist[]);
        setChecklistsLoading(false);
      });
  }, [orgId, supabase]);

  const checklistsFor = (clientId: string) =>
    allChecklists.filter(cl => cl.client_id === clientId);

  // ── Selection state ────────────────────────────────────────────────────────
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedChecklistId, setSelectedChecklistId] = useState<string | 'new' | null>(null);
  const [clientSearch, setClientSearch] = useState('');
  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set());

  // Auto-select and expand first client
  useEffect(() => {
    if (!selectedClientId && clients.length > 0) {
      const first = clients[0];
      setSelectedClientId(first.id);
      setExpandedClients(new Set([first.id]));
    }
  }, [clients, selectedClientId]);

  const toggleExpand = (clientId: string) => {
    setExpandedClients(prev => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  };

  const selectClient = (clientId: string) => {
    setSelectedClientId(clientId);
    setSelectedChecklistId(null);
    if (!expandedClients.has(clientId)) {
      setExpandedClients(prev => new Set([...prev, clientId]));
    }
  };

  const selectChecklist = (clientId: string, checklistId: string) => {
    setSelectedClientId(clientId);
    setSelectedChecklistId(checklistId);
    const cl = allChecklists.find(c => c.id === checklistId);
    if (cl) {
      const migrated = (cl.sections as Record<string, unknown>[]).map(s => migrateOldSection(s));
      setBuilderSections(migrated);
      setBuilderName(cl.name);
      setBuilderIsDefault(cl.is_default);
    }
  };

  const openNewChecklist = (clientId: string) => {
    setSelectedClientId(clientId);
    setSelectedChecklistId('new');
    setBuilderSections([{ id: crypto.randomUUID(), title: '', fields: [] }]);
    setBuilderName('');
    setBuilderIsDefault(checklistsFor(clientId).length === 0);
  };

  // ── Builder state ──────────────────────────────────────────────────────────
  const [builderSections, setBuilderSections] = useState<ChecklistSection[]>([]);
  const [builderName, setBuilderName] = useState('');
  const [builderIsDefault, setBuilderIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async (name: string, sections: ChecklistSection[], isDefault: boolean) => {
    if (!orgId || !selectedClientId) return;
    setSaving(true);

    if (selectedChecklistId === 'new') {
      const { data } = await supabase
        .from('client_checklists')
        .insert({ org_id: orgId, client_id: selectedClientId, name, sections, is_default: isDefault })
        .select('*').single() as { data: ClientChecklist | null };
      if (data) {
        setAllChecklists(prev => {
          const updated = isDefault
            ? prev.map(c => c.client_id === selectedClientId ? { ...c, is_default: false } : c)
            : prev;
          return [...updated, data];
        });
        setSelectedChecklistId(data.id);
      }
    } else if (selectedChecklistId) {
      await supabase.from('client_checklists')
        .update({ name, sections, is_default: isDefault, updated_at: new Date().toISOString() })
        .eq('id', selectedChecklistId);
      setAllChecklists(prev => prev.map(c => {
        if (c.id === selectedChecklistId) return { ...c, name, sections: sections as unknown[], is_default: isDefault };
        if (isDefault && c.client_id === selectedClientId) return { ...c, is_default: false };
        return c;
      }));
    }

    setSaving(false);
  }, [orgId, selectedClientId, selectedChecklistId, supabase]);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    await supabase.from('client_checklists').delete().eq('id', id);
    setAllChecklists(prev => prev.filter(c => c.id !== id));
    if (selectedChecklistId === id) setSelectedChecklistId(null);
  };

  const filteredClients = useMemo(() =>
    clients.filter(c => !clientSearch || c.name.toLowerCase().includes(clientSearch.toLowerCase())),
    [clients, clientSearch]
  );

  const selectedChecklist = useMemo(() =>
    selectedChecklistId && selectedChecklistId !== 'new'
      ? allChecklists.find(c => c.id === selectedChecklistId) ?? null
      : null,
    [selectedChecklistId, allChecklists]
  );

  return (
    <div className="h-full flex overflow-hidden">

      {/* ══ LEFT: clients + nested checklists ════════════════════════════════ */}
      <div className="w-72 shrink-0 flex flex-col border-r border-border-light bg-surface-elevated/40">
        {/* Search */}
        <div className="shrink-0 p-3 border-b border-border-light">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input value={clientSearch} onChange={e => setClientSearch(e.target.value)}
              placeholder="Search clients…" className="input-field text-sm w-full pl-8 py-2"/>
          </div>
        </div>

        {/* Client + checklist tree */}
        <div className="flex-1 overflow-y-auto custom-scrollbar divide-y divide-border-light/40">
          {filteredClients.map(client => {
            const cls = checklistsFor(client.id);
            const isExpanded = expandedClients.has(client.id);
            const isClientSelected = selectedClientId === client.id && !selectedChecklistId;

            return (
              <div key={client.id}>
                {/* Client row */}
                <div className={`flex items-center gap-2 pr-2 transition-colors ${isClientSelected ? 'bg-primary/5' : 'hover:bg-surface-elevated'}`}>
                  {/* Expand toggle */}
                  <button onClick={() => toggleExpand(client.id)}
                    className="p-2 shrink-0 text-text-tertiary hover:text-text-primary transition-colors">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                      className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                  </button>

                  {/* Avatar + name */}
                  <button onClick={() => selectClient(client.id)} className="flex items-center gap-2.5 flex-1 py-2.5 text-left min-w-0">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-xs font-bold shrink-0"
                      style={{ backgroundColor: client.color || '#6366f1' }}>
                      {client.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold truncate ${isClientSelected ? 'text-primary' : 'text-text-primary'}`}>
                        {client.name}
                      </p>
                      {!checklistsLoading && (
                        <p className="text-[11px] text-text-tertiary">
                          {cls.length} checklist{cls.length !== 1 ? 's' : ''}
                        </p>
                      )}
                    </div>
                  </button>
                </div>

                {/* Checklists under this client */}
                <AnimatePresence initial={false}>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      {cls.length === 0 && !checklistsLoading ? (
                        <p className="pl-10 pr-3 py-2 text-[11px] text-text-tertiary italic">No checklists yet</p>
                      ) : (
                        cls.map(cl => {
                          const isActive = selectedChecklistId === cl.id;
                          return (
                            <button key={cl.id}
                              onClick={() => selectChecklist(client.id, cl.id)}
                              className={`w-full flex items-center gap-2.5 pl-10 pr-3 py-2 transition-colors text-left ${isActive ? 'bg-primary/10 border-r-2 border-primary' : 'hover:bg-surface-elevated'}`}>
                              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${cl.is_default ? 'bg-primary' : 'bg-border-light'}`}/>
                              <span className={`text-xs flex-1 truncate ${isActive ? 'text-primary font-semibold' : 'text-text-secondary font-medium'}`}>
                                {cl.name}
                              </span>
                              {cl.is_default && (
                                <span className="text-[9px] font-bold text-primary shrink-0">Default</span>
                              )}
                            </button>
                          );
                        })
                      )}

                      {/* + New checklist */}
                      <button onClick={() => openNewChecklist(client.id)}
                        className={`w-full flex items-center gap-2 pl-10 pr-3 py-2 text-[11px] font-semibold transition-colors ${selectedChecklistId === 'new' && selectedClientId === client.id ? 'text-primary' : 'text-text-tertiary hover:text-primary'}`}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        New checklist
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>

      {/* ══ RIGHT: checklist editor OR client profile ════════════════════════ */}
      <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
        <AnimatePresence mode="wait">
          {/* ── Checklist editor ── */}
          {selectedChecklistId ? (
            <motion.div key={selectedChecklistId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {/* Editor header */}
              <div className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-border-light bg-white">
                <button onClick={() => setSelectedChecklistId(null)}
                  className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-elevated transition-colors shrink-0">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-text-tertiary truncate">
                    {clients.find(c => c.id === selectedClientId)?.name}
                  </p>
                  <h2 className="text-sm font-bold text-text-primary truncate">
                    {selectedChecklistId === 'new' ? 'New Checklist' : selectedChecklist?.name || 'Edit Checklist'}
                  </h2>
                </div>
                {selectedChecklist && (
                  <button onClick={() => handleDelete(selectedChecklist.id, selectedChecklist.name)}
                    className="text-xs font-semibold text-text-tertiary hover:text-rose-500 px-2 py-1 rounded-lg hover:bg-rose-50 transition-colors shrink-0">
                    Delete
                  </button>
                )}
              </div>

              {/* Builder */}
              <div className="flex-1 min-h-0 overflow-hidden">
                <ChecklistBuilder
                  key={selectedChecklistId}
                  sections={builderSections}
                  onChange={setBuilderSections}
                  initialName={builderName}
                  initialIsDefault={builderIsDefault}
                  mode="client-profile"
                  saving={saving}
                  onSave={handleSave}
                  onCancel={selectedChecklistId === 'new' ? () => setSelectedChecklistId(null) : undefined}
                />
              </div>
            </motion.div>
          ) : selectedClientId && orgId ? (
            /* ── Client profile ── */
            <motion.div key={selectedClientId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex-1 min-h-0 overflow-hidden">
              <ClientProfileView
                key={selectedClientId}
                clientId={selectedClientId}
                orgId={orgId}
              />
            </motion.div>
          ) : (
            /* ── Empty ── */
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex-1 flex items-center justify-center text-center px-8">
              <div>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-tertiary mx-auto mb-3">
                  <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
                  <rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/>
                </svg>
                <p className="text-sm font-semibold text-text-secondary">Select a client</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
