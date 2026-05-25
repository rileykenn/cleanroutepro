'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';

interface AssignTemplateModalProps {
  masterId: string;
  masterName: string;
  orgId: string;
  onClose: () => void;
  onConfirm: (clientIds: string[], overwrite: boolean) => Promise<void>;
}

interface ClientRow {
  id: string;
  name: string;
  address: string;
  color: string | null;
}

export default function AssignTemplateModal({ masterId, masterName, orgId, onClose, onConfirm }: AssignTemplateModalProps) {
  const supabase = useMemo(() => createClient(), []);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [alreadyAssigned, setAlreadyAssigned] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState(false);
  const [done, setDone] = useState(false);

  // Load clients + existing assignments
  useEffect(() => {
    if (!orgId) return;
    (async () => {
      const [{ data: clientData }, { data: existingData }] = await Promise.all([
        supabase.from('clients').select('id, name, address, color').eq('org_id', orgId).order('name'),
        supabase.from('client_checklists').select('client_id').eq('org_id', orgId).eq('source_template_id', masterId),
      ]);
      if (clientData) setClients(clientData as ClientRow[]);
      if (existingData) {
        setAlreadyAssigned(new Set(existingData.map((r: { client_id: string }) => r.client_id)));
      }
      setLoading(false);
    })();
  }, [orgId, masterId, supabase]);

  const filtered = useMemo(() => {
    if (!search) return clients;
    const q = search.toLowerCase();
    return clients.filter(c => c.name.toLowerCase().includes(q) || c.address.toLowerCase().includes(q));
  }, [clients, search]);

  const toggleClient = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === filtered.length) {
      // Deselect all filtered
      setSelected(prev => {
        const next = new Set(prev);
        for (const c of filtered) next.delete(c.id);
        return next;
      });
    } else {
      // Select all filtered
      setSelected(prev => {
        const next = new Set(prev);
        for (const c of filtered) next.add(c.id);
        return next;
      });
    }
  };

  const hasOverwrites = useMemo(() => {
    for (const id of selected) {
      if (alreadyAssigned.has(id)) return true;
    }
    return false;
  }, [selected, alreadyAssigned]);

  const newCount = useMemo(() => {
    let count = 0;
    for (const id of selected) {
      if (!alreadyAssigned.has(id)) count++;
    }
    return count;
  }, [selected, alreadyAssigned]);

  const overwriteCount = useMemo(() => {
    let count = 0;
    for (const id of selected) {
      if (alreadyAssigned.has(id)) count++;
    }
    return count;
  }, [selected, alreadyAssigned]);

  const handleAssign = useCallback(async () => {
    if (selected.size === 0) return;
    setAssigning(true);
    await onConfirm(Array.from(selected), hasOverwrites);
    setAssigning(false);
    setDone(true);
  }, [selected, hasOverwrites, onConfirm]);

  const allFilteredSelected = filtered.length > 0 && filtered.every(c => selected.has(c.id));

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 20, opacity: 0, scale: 0.97 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 20, opacity: 0, scale: 0.97 }}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="shrink-0 p-5 border-b border-border-light">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
                </svg>
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-text-primary">Assign to Clients</h3>
                <p className="text-xs text-text-tertiary truncate">{masterName}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>

        {done ? (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="p-8 text-center">
            <div className="text-4xl mb-3">✅</div>
            <p className="text-sm font-semibold text-text-primary">
              Template assigned to {selected.size} client{selected.size !== 1 ? 's' : ''}!
            </p>
            {overwriteCount > 0 && (
              <p className="text-xs text-text-tertiary mt-1">{overwriteCount} existing checklist{overwriteCount !== 1 ? 's' : ''} updated</p>
            )}
          </motion.div>
        ) : (
          <>
            {/* Search + select all */}
            <div className="shrink-0 px-4 pt-3 pb-2 flex items-center gap-2">
              <div className="relative flex-1">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input
                  value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search clients…"
                  className="input-field text-sm w-full pl-10 py-2"
                />
              </div>
              <button
                onClick={selectAll}
                className="btn-ghost text-xs shrink-0 py-2"
              >
                {allFilteredSelected ? 'Deselect All' : 'Select All'}
              </button>
            </div>

            {/* Client list */}
            <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pb-2">
              {loading ? (
                <div className="space-y-2 py-2">{[1,2,3,4,5].map(i => <div key={i} className="shimmer h-14 rounded-xl"/>)}</div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-sm text-text-tertiary">{clients.length === 0 ? 'No clients in your org' : 'No clients match your search'}</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {filtered.map(client => {
                    const isSelected = selected.has(client.id);
                    const isAssigned = alreadyAssigned.has(client.id);
                    return (
                      <button
                        key={client.id}
                        onClick={() => toggleClient(client.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all ${
                          isSelected
                            ? 'bg-primary/5 ring-1 ring-primary/20'
                            : 'hover:bg-surface-elevated'
                        }`}
                      >
                        {/* Checkbox */}
                        <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all ${
                          isSelected
                            ? 'bg-primary border-primary'
                            : 'border-border bg-white'
                        }`}>
                          {isSelected && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                          )}
                        </div>

                        {/* Avatar */}
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0"
                          style={{ backgroundColor: client.color || '#6366f1' }}
                        >
                          {client.name.charAt(0).toUpperCase()}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-text-primary truncate">{client.name}</p>
                          {client.address && (
                            <p className="text-[11px] text-text-tertiary truncate">{client.address}</p>
                          )}
                        </div>

                        {/* Already assigned badge */}
                        {isAssigned && (
                          <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md shrink-0">
                            Assigned
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="shrink-0 p-4 border-t border-border-light bg-surface-elevated/50">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-text-secondary">
                  <span className="font-bold text-text-primary">{selected.size}</span> of {clients.length} client{clients.length !== 1 ? 's' : ''} selected
                </p>
                {hasOverwrites && (
                  <p className="text-[11px] text-amber-600 flex items-center gap-1">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                    {overwriteCount} will be updated
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleAssign}
                  disabled={assigning || selected.size === 0}
                  className="btn-primary flex-1 text-sm py-2.5 disabled:opacity-50"
                >
                  {assigning ? (
                    <>
                      <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                      Assigning…
                    </>
                  ) : (
                    <>
                      Assign to {selected.size} Client{selected.size !== 1 ? 's' : ''}
                    </>
                  )}
                </button>
                <button onClick={onClose} className="btn-ghost text-sm">Cancel</button>
              </div>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
