'use client';

import { useState, useMemo, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/hooks/useAuth';
import { useClients, SavedClient } from '@/lib/hooks/useClients';
import { createClient as createSupabaseClient } from '@/lib/supabase/client';
import { generateId } from '@/lib/timeUtils';
import { CLIENT_COLORS } from '@/lib/types';

const ClientInfoPanel = lazy(() => import('@/components/ClientInfoPanel'));

// ── Duration helpers ───────────────────────────────────────────────────────────
function minutesToHM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}
function hmToMinutes(str: string): number | null {
  const trimmed = str.trim();
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx === -1) {
    const h = parseInt(trimmed, 10);
    if (isNaN(h) || h < 0) return null;
    return h * 60;
  }
  const h = parseInt(trimmed.slice(0, colonIdx), 10);
  const m = parseInt(trimmed.slice(colonIdx + 1), 10);
  if (isNaN(h) || isNaN(m) || h < 0 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

interface ChecklistTemplate { id: string; name: string; items: { id: string; text: string }[]; }

export default function ClientsPage() {
  const { profile } = useAuth();
  const router = useRouter();
  const { clients, loading, addClient, updateClient, deleteClient, searchClients: searchFn } = useClients(profile?.org_id || null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', address: '', email: '', phone: '', default_duration_minutes: 90, default_staff_count: 1, notes: '' });
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [customizingId, setCustomizingId] = useState<string | null>(null);
  const [customItems, setCustomItems] = useState<{ id: string; text: string }[]>([]);
  const [infoClientId, setInfoClientId] = useState<string | null>(null);
  const [infoClientName, setInfoClientName] = useState('');
  const [colorPickerId, setColorPickerId] = useState<string | null>(null);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const colorTriggerRef = useRef<HTMLButtonElement>(null);
  // h:mm duration string for the add/edit form
  const [durationHM, setDurationHM] = useState(() => minutesToHM(90));

  // Close color picker on outside click
  useEffect(() => {
    if (!colorPickerId) return;
    const handler = (e: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node) &&
          colorTriggerRef.current && !colorTriggerRef.current.contains(e.target as Node)) {
        setColorPickerId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [colorPickerId]);

  useEffect(() => {
    if (profile?.org_id) {
      supabase.from('checklist_templates').select('id, name, items').eq('org_id', profile.org_id).then(({ data }: { data: ChecklistTemplate[] | null }) => { if (data) setTemplates(data); });
    }
  }, [profile?.org_id, supabase]);

  const filtered = searchQuery.trim() ? searchFn(searchQuery) : clients;

  const handleAdd = async () => {
    const mins = hmToMinutes(durationHM);
    const duration = mins !== null && mins > 0 ? mins : form.default_duration_minutes;
    await addClient({ ...form, default_duration_minutes: duration, lat: null, lng: null, place_id: null, checklist_template_id: null, custom_checklist_items: null, color: null, rate: null });
    setForm({ name: '', address: '', email: '', phone: '', default_duration_minutes: 90, default_staff_count: 1, notes: '' });
    setDurationHM(minutesToHM(90));
    setShowAdd(false);
  };

  const handleEdit = (client: SavedClient) => {
    setEditingId(client.id);
    setForm({ name: client.name, address: client.address, email: client.email || '', phone: client.phone || '', default_duration_minutes: client.default_duration_minutes, default_staff_count: client.default_staff_count, notes: client.notes || '' });
    setDurationHM(minutesToHM(client.default_duration_minutes));
  };

  const handleUpdate = async () => {
    if (!editingId) return;
    const mins = hmToMinutes(durationHM);
    const duration = mins !== null && mins > 0 ? mins : form.default_duration_minutes;
    await updateClient(editingId, { ...form, default_duration_minutes: duration });
    setEditingId(null);
    setDurationHM(minutesToHM(90));
    setForm({ name: '', address: '', email: '', phone: '', default_duration_minutes: 90, default_staff_count: 1, notes: '' });
  };

  const assignTemplate = useCallback(async (clientId: string, templateId: string | null) => {
    await updateClient(clientId, { checklist_template_id: templateId, custom_checklist_items: null } as Partial<SavedClient>);
  }, [updateClient]);

  const startCustomise = (client: SavedClient) => {
    setCustomizingId(client.id);
    if (client.custom_checklist_items && client.custom_checklist_items.length > 0) {
      setCustomItems([...client.custom_checklist_items]);
    } else {
      const tmpl = templates.find(t => t.id === client.checklist_template_id);
      if (tmpl?.items) {
        setCustomItems(tmpl.items.map(it => ({ id: it.id, text: it.text })));
      } else {
        setCustomItems([{ id: generateId(), text: '' }]);
      }
    }
  };

  const saveCustomItems = async (clientId: string) => {
    const cleanItems = customItems.filter(it => it.text.trim());
    await updateClient(clientId, { custom_checklist_items: cleanItems.length > 0 ? cleanItems : null } as Partial<SavedClient>);
    setCustomizingId(null);
  };

  const resetToTemplate = async (clientId: string) => {
    await updateClient(clientId, { custom_checklist_items: null } as Partial<SavedClient>);
    setCustomizingId(null);
  };

  if (loading) return <div className="p-6 space-y-3">{[1,2,3].map(i => <div key={i} className="shimmer h-20 rounded-xl" />)}</div>;

  return (
    <div className="h-full overflow-y-auto p-4 lg:p-6 custom-scrollbar pb-24 lg:pb-6">
      <div className="max-w-[800px] mx-auto space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div><h2 className="text-lg font-bold text-text-primary">Clients</h2><p className="text-sm text-text-secondary">{clients.length} saved clients</p></div>
          <button onClick={() => setShowAdd(!showAdd)} className="btn-primary text-sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Client
          </button>
        </div>

        <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
          className="input-field" placeholder="Search clients by name or address..." />

        <AnimatePresence>
          {(showAdd || editingId) && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="card-elevated p-5 space-y-4 overflow-hidden">
              <h3 className="text-sm font-bold text-text-primary">{editingId ? 'Edit Client' : 'New Client'}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="block text-xs font-medium text-text-secondary mb-1">Name</label>
                  <input type="text" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} className="input-field text-sm" placeholder="Client name" /></div>
                <div><label className="block text-xs font-medium text-text-secondary mb-1">Address</label>
                  <input type="text" value={form.address} onChange={(e) => setForm({...form, address: e.target.value})} className="input-field text-sm" placeholder="Full address" /></div>
                <div><label className="block text-xs font-medium text-text-secondary mb-1">Email</label>
                  <input type="email" value={form.email} onChange={(e) => setForm({...form, email: e.target.value})} className="input-field text-sm" placeholder="email@example.com" /></div>
                <div><label className="block text-xs font-medium text-text-secondary mb-1">Phone</label>
                  <input type="tel" value={form.phone} onChange={(e) => setForm({...form, phone: e.target.value})} className="input-field text-sm" placeholder="0400 000 000" /></div>
                <div><label className="block text-xs font-medium text-text-secondary mb-1">Default Duration (h:mm)</label>
                  <input type="text" inputMode="numeric" value={durationHM}
                    onChange={e => setDurationHM(e.target.value)}
                    onBlur={() => { const mins = hmToMinutes(durationHM); if (mins !== null && mins > 0) { setDurationHM(minutesToHM(mins)); setForm({...form, default_duration_minutes: mins}); } }}
                    className="input-field text-sm" placeholder="h:mm (e.g. 1:30)" /></div>
                <div><label className="block text-xs font-medium text-text-secondary mb-1">Default Staff Count</label>
                  <input type="number" value={form.default_staff_count} onChange={(e) => setForm({...form, default_staff_count: Number(e.target.value)})} className="input-field text-sm" min={1} /></div>
              </div>
              <div><label className="block text-xs font-medium text-text-secondary mb-1">Notes</label>
                <textarea value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})} className="input-field text-sm resize-none" rows={2} placeholder="Access codes, special instructions..." /></div>
              <div className="flex gap-2">
                <button onClick={editingId ? handleUpdate : handleAdd} className="btn-primary text-sm">{editingId ? 'Save Changes' : 'Add Client'}</button>
                <button onClick={() => { setShowAdd(false); setEditingId(null); setDurationHM(minutesToHM(90)); setForm({ name: '', address: '', email: '', phone: '', default_duration_minutes: 90, default_staff_count: 1, notes: '' }); }} className="btn-ghost text-sm">Cancel</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="space-y-2">
          {filtered.map((client, i) => (
            <motion.div key={client.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
              className="card p-4 group cursor-pointer hover:shadow-card-hover transition-all"
              onClick={() => router.push(`/dashboard/clients/${client.id}`)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {client.color && <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: client.color }} />}
                    <h4 className="text-sm font-bold text-text-primary">{client.name}</h4>
                  </div>
                  <p className="text-xs text-text-tertiary truncate mt-0.5">{client.address}</p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-text-secondary flex-wrap">
                    <span>{minutesToHM(client.default_duration_minutes)}</span>
                    <span>·</span>
                    <span>{client.default_staff_count} staff</span>
                    {client.email && <><span>·</span><span>{client.email}</span></>}
                    {client.phone && <><span>·</span><span>{client.phone}</span></>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 md:opacity-0 md:group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                  {/* Color tag popover */}
                  <div className="relative mr-1">
                    <button
                      ref={colorPickerId === client.id ? colorTriggerRef : undefined}
                      onClick={() => setColorPickerId(colorPickerId === client.id ? null : client.id)}
                      className={`w-7 h-7 rounded-lg border-2 transition-all hover:scale-105 flex items-center justify-center ${
                        colorPickerId === client.id ? 'border-primary shadow-sm' : 'border-border-light hover:border-gray-300'
                      }`}
                      title="Set colour"
                    >
                      {client.color ? (
                        <div className="w-4 h-4 rounded-full" style={{ backgroundColor: client.color }} />
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-tertiary">
                          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                        </svg>
                      )}
                    </button>
                    <AnimatePresence>
                      {colorPickerId === client.id && (
                        <motion.div
                          ref={colorPickerRef}
                          initial={{ opacity: 0, y: -4, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -4, scale: 0.95 }}
                          transition={{ duration: 0.15 }}
                          className="absolute right-0 top-full mt-2 z-40 bg-white rounded-xl shadow-lg border border-border-light p-3 w-[200px]"
                        >
                          <div className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider mb-2">Colour Tag</div>
                          <div className="grid grid-cols-5 gap-1.5">
                            {CLIENT_COLORS.map((c) => (
                              <button
                                key={c.value}
                                onClick={() => {
                                  updateClient(client.id, { color: client.color === c.value ? null : c.value } as Partial<SavedClient>);
                                  setColorPickerId(null);
                                }}
                                className={`w-8 h-8 rounded-lg border-2 transition-all hover:scale-110 flex items-center justify-center ${
                                  client.color === c.value ? 'border-gray-700 scale-110 shadow-sm' : 'border-transparent hover:border-gray-200'
                                }`}
                                style={{ backgroundColor: c.value }}
                                title={c.name}
                              >
                                {client.color === c.value && (
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                                )}
                              </button>
                            ))}
                          </div>
                          {client.color && (
                            <button
                              onClick={() => {
                                updateClient(client.id, { color: null } as Partial<SavedClient>);
                                setColorPickerId(null);
                              }}
                              className="w-full mt-2 pt-2 border-t border-border-light text-xs text-text-tertiary hover:text-danger transition-colors text-center py-1.5"
                            >
                              Clear colour
                            </button>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  <button onClick={() => deleteClient(client.id)} className="p-1.5 rounded-lg hover:bg-danger-light text-text-tertiary hover:text-danger transition-colors" title="Delete">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                  {/* View profile arrow */}
                  <div className="w-7 h-7 rounded-lg bg-surface-elevated flex items-center justify-center text-text-tertiary">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
          {filtered.length === 0 && !loading && (
            <div className="text-center py-12"><p className="text-text-tertiary text-sm">{searchQuery ? 'No clients match your search.' : 'No clients yet. Add your first client above.'}</p></div>
          )}
        </div>
      </div>
    </div>
  );
}
