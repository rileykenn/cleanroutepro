'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { APIProvider } from '@vis.gl/react-google-maps';
import { useAuth } from '@/lib/hooks/useAuth';
import { useClients } from '@/lib/hooks/useClients';
import { createClient as createSupabaseClient } from '@/lib/supabase/client';
import { ChecklistSection, migrateOldSection } from '@/components/checklist/types';
import ChecklistBuilder from '@/components/checklist/ChecklistBuilder';
import ClientProfileView from '@/components/ClientProfileView';
import PlacesAutocomplete from '@/components/PlacesAutocomplete';
import { useChecklistMasters } from '@/lib/hooks/useChecklistMasters';
import type { Location } from '@/lib/types';

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

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
  const router = useRouter();
  const orgId = profile?.org_id || null;
  const supabase = useMemo(() => createSupabaseClient(), []);

  // Staff should not access this page
  useEffect(() => {
    if (profile?.role === 'staff') router.replace('/dashboard/staff-view');
  }, [profile?.role, router]);

  const { clients, addClient, deleteClient } = useClients(orgId);

  // ── New-client draft (local, no DB until all required fields are set) ─────
  const [draftClient, setDraftClient] = useState<{
    name: string;
    address: string;
    addressLat: number | null;
    addressLng: number | null;
    addressPlaceId: string | null;
    rate: string;
  } | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);

  const handleAddClient = () => {
    // Show the draft form — don't touch the DB yet
    setSelectedClientId(null);
    setSelectedChecklistId(null);
    setDraftClient({ name: '', address: '', addressLat: null, addressLng: null, addressPlaceId: null, rate: '' });
  };

  const draftReady = draftClient
    && draftClient.name.trim() !== ''
    && draftClient.address.trim() !== ''
    && draftClient.rate.trim() !== '';

  const handleCreateDraft = async () => {
    if (!draftReady || !draftClient || savingDraft) return;
    setSavingDraft(true);
    const saved = await addClient({
      name: draftClient.name.trim(),
      address: draftClient.address.trim(),
      email: '', phone: '',
      default_duration_minutes: 90,
      default_staff_count: 1,
      notes: '',
      lat: draftClient.addressLat,
      lng: draftClient.addressLng,
      place_id: draftClient.addressPlaceId,
      checklist_template_id: null,
      custom_checklist_items: null,
      color: null,
      rate: Number(draftClient.rate),
    });
    setSavingDraft(false);
    setDraftClient(null);
    if (saved?.id) {
      setSelectedClientId(saved.id);
      setExpandedClients(prev => new Set([...prev, saved.id]));
    }
  };


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
    // If already viewing this checklist, don't reload (would wipe unsaved edits)
    if (selectedChecklistId === checklistId) return;
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

  const [builderSections, setBuilderSections] = useState<ChecklistSection[]>([]);
  const [builderName, setBuilderName] = useState('');
  const [builderIsDefault, setBuilderIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAsTemplate, setSavedAsTemplate] = useState(false);
  const { addMaster } = useChecklistMasters(orgId);

  // ── Inline rename state ─────────────────────────────────────────────────────
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const startRename = (cl: { id: string; name: string }) => {
    setRenamingId(cl.id);
    setRenameValue(cl.name);
  };

  const commitRename = async () => {
    if (!renamingId) return;
    const trimmed = renameValue.trim();
    if (!trimmed) { setRenamingId(null); return; }
    // Update in DB
    await supabase.from('client_checklists').update({ name: trimmed }).eq('id', renamingId);
    // Update local state
    setAllChecklists(prev => prev.map(c => c.id === renamingId ? { ...c, name: trimmed } : c));
    // Update builder name if this checklist is currently selected
    if (selectedChecklistId === renamingId) setBuilderName(trimmed);
    setRenamingId(null);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue('');
  };

  const handleSaveAsTemplate = useCallback(async () => {
    if (!selectedChecklistId || selectedChecklistId === 'new') return;
    const checklist = allChecklists.find(c => c.id === selectedChecklistId);
    if (!checklist) return;
    const migrated = (checklist.sections as Record<string, unknown>[]).map(s => migrateOldSection(s));
    await addMaster(checklist.name || 'Untitled Template', migrated);
    setSavedAsTemplate(true);
    setTimeout(() => setSavedAsTemplate(false), 2000);
  }, [selectedChecklistId, allChecklists, addMaster]);

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
    <APIProvider apiKey={MAPS_KEY} libraries={['places']}>
      <div className="h-full flex overflow-hidden">

      {/* ══ LEFT: clients + nested checklists — always visible ══ */}
      <div className="w-52 md:w-60 shrink-0 flex flex-col border-r border-border-light bg-surface-elevated/40">
        {/* Header: Search + Add Client */}
        <div className="shrink-0 p-3 border-b border-border-light space-y-2">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input value={clientSearch} onChange={e => setClientSearch(e.target.value)}
              placeholder="Search clients…" className="input-field text-sm w-full py-2"
              style={{ paddingLeft: '2.5rem' }}/>
          </div>
          {/* Add Client */}
          <button
            onClick={handleAddClient}
            className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-text-tertiary hover:text-primary hover:bg-primary/5 rounded-lg py-1.5 transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New Client
          </button>
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
                            <div key={cl.id}
                              className={`w-full flex items-center gap-2.5 pl-10 pr-3 py-2 transition-colors text-left cursor-pointer ${isActive ? 'bg-primary/10 border-r-2 border-primary' : 'hover:bg-surface-elevated'}`}
                              onClick={() => selectChecklist(client.id, cl.id)}
                              onDoubleClick={(e) => { e.stopPropagation(); startRename(cl); }}
                            >
                              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${cl.is_default ? 'bg-primary' : 'bg-border-light'}`}/>
                              {renamingId === cl.id ? (
                                <input
                                  ref={renameInputRef}
                                  type="text"
                                  value={renameValue}
                                  onChange={e => setRenameValue(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') commitRename();
                                    if (e.key === 'Escape') cancelRename();
                                  }}
                                  onBlur={() => commitRename()}
                                  onClick={e => e.stopPropagation()}
                                  className="flex-1 text-xs font-medium bg-white border border-primary rounded-md px-2 py-0.5 outline-none focus:ring-1 focus:ring-primary/30 text-text-primary min-w-0"
                                />
                              ) : (
                                <span className={`text-xs flex-1 truncate ${isActive ? 'text-primary font-semibold' : 'text-text-secondary font-medium'}`}>
                                  {cl.name}
                                </span>
                              )}
                              {cl.is_default && (
                                <span className="text-[9px] font-bold text-primary shrink-0">Default</span>
                              )}
                            </div>
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

      {/* ══ RIGHT: checklist editor OR client profile — always visible ══ */}
      <div className="flex flex-1 min-w-0 overflow-hidden flex-col">
        <AnimatePresence mode="wait">
          {/* ── Checklist editor ── */}
          {selectedChecklistId ? (
            <motion.div key={selectedChecklistId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {/* Editor header */}
              <div className="shrink-0 flex items-center gap-3 px-4 lg:px-5 py-3 border-b border-border-light bg-white">
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
                  <div className="flex items-center gap-1.5 shrink-0">
                    {savedAsTemplate ? (
                      <span className="text-xs font-semibold text-emerald-500 flex items-center gap-1 px-2 py-1">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                        Saved!
                      </span>
                    ) : (
                      <button onClick={handleSaveAsTemplate}
                        className="text-xs font-semibold text-text-tertiary hover:text-primary px-2 py-1 rounded-lg hover:bg-primary/5 transition-colors"
                        title="Save this checklist as a reusable master template">
                        Save as Template
                      </button>
                    )}
                    <button onClick={() => handleDelete(selectedChecklist.id, selectedChecklist.name)}
                      className="text-xs font-semibold text-text-tertiary hover:text-rose-500 px-2 py-1 rounded-lg hover:bg-rose-50 transition-colors">
                      Delete
                    </button>
                  </div>
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
          ) : draftClient ? (
            /* ── New client draft form ── */
            <motion.div key="new-client-draft" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
              <div className="p-4 max-w-lg space-y-3 pb-16">

                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-text-primary">New Client</h2>
                  <button onClick={() => setDraftClient(null)}
                    className="text-xs text-text-tertiary hover:text-text-primary transition-colors">
                    Cancel
                  </button>
                </div>

                {/* Name */}
                <div className="bg-white rounded-2xl border border-border-light p-4 space-y-1">
                  <label className="text-xs font-semibold text-text-tertiary">Client Name <span className="text-danger">*</span></label>
                  <input
                    autoFocus
                    value={draftClient.name}
                    onChange={e => setDraftClient(d => d ? { ...d, name: e.target.value } : d)}
                    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    placeholder="Client's name"
                    className="w-full border border-border-light rounded-xl px-3 py-2.5 text-sm font-semibold text-text-primary placeholder:text-text-tertiary placeholder:font-normal bg-surface-elevated/40 hover:bg-white focus:bg-white focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10 transition-all"
                  />
                </div>

                {/* Address */}
                <div className="bg-white rounded-2xl border border-border-light p-4 space-y-1">
                  <label className="text-xs font-semibold text-text-tertiary">Address <span className="text-danger">*</span></label>
                  <PlacesAutocomplete
                    defaultValue={draftClient.address}
                    placeholder="Search address…"
                    className="w-full text-sm"
                    onPlaceSelect={(loc: Location) =>
                      setDraftClient(d => d ? { ...d, address: loc.address, addressLat: loc.lat, addressLng: loc.lng, addressPlaceId: loc.placeId ?? null } : d)
                    }
                    onTextChange={(text: string) =>
                      setDraftClient(d => d ? { ...d, address: text, addressLat: null, addressLng: null, addressPlaceId: null } : d)
                    }
                  />
                  <p className="text-[10px] text-text-tertiary">Used for route calculations</p>
                </div>

                {/* Rate */}
                <div className="bg-white rounded-2xl border border-border-light p-4 space-y-1">
                  <label className="text-xs font-semibold text-text-tertiary">Hourly Rate ($/hr) <span className="text-danger">*</span></label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-tertiary">$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={draftClient.rate}
                      onChange={e => setDraftClient(d => d ? { ...d, rate: e.target.value } : d)}
                      placeholder="0.00"
                      className="w-full border border-border-light rounded-xl pl-7 pr-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary bg-surface-elevated/40 hover:bg-white focus:bg-white focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10 transition-all"
                    />
                  </div>
                </div>

                {/* Create button */}
                <button
                  onClick={handleCreateDraft}
                  disabled={!draftReady || savingDraft}
                  className="w-full py-3 rounded-2xl text-sm font-bold transition-all
                    disabled:bg-surface-elevated disabled:text-text-tertiary disabled:border disabled:border-border-light disabled:cursor-not-allowed
                    enabled:bg-primary enabled:text-white enabled:hover:bg-primary-hover enabled:shadow-sm"
                >
                  {savingDraft ? 'Creating…' : !draftReady ? 'Fill in all required fields to continue' : 'Create Client'}
                </button>

              </div>
            </motion.div>

          ) : selectedClientId && orgId ? (
            /* ── Client profile ── */
            <motion.div key={selectedClientId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex-1 min-h-0 overflow-hidden flex flex-col">
              <div className="flex-1 min-h-0 overflow-hidden">
                <ClientProfileView
                  key={selectedClientId}
                  clientId={selectedClientId}
                  orgId={orgId}
                  hideRates={profile?.role === 'staff'}
                  onDelete={async () => {
                    await deleteClient(selectedClientId);
                    setSelectedClientId(null);
                    setSelectedChecklistId(null);
                  }}
                />
              </div>
            </motion.div>

          ) : (
            /* ── Empty state ── */
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
    </APIProvider>
  );
}
