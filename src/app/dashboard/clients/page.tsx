'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/hooks/useAuth';
import { useClients, SavedClient } from '@/lib/hooks/useClients';
import { createClient as createSupabaseClient } from '@/lib/supabase/client';

export default function ClientsPage() {
  const { profile } = useAuth();
  const { clients, loading, addClient, updateClient, deleteClient, searchClients: searchFn } = useClients(profile?.org_id || null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', address: '', email: '', phone: '', default_duration_minutes: 90, default_staff_count: 1, notes: '' });
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (profile?.org_id) {
      supabase.from('checklist_templates').select('id, name').eq('org_id', profile.org_id).then(({ data }: { data: { id: string; name: string }[] | null }) => { if (data) setTemplates(data); });
    }
  }, [profile?.org_id, supabase]);

  const filtered = searchQuery.trim() ? searchFn(searchQuery) : clients;

  const handleAdd = async () => {
    await addClient({ ...form, lat: null, lng: null, place_id: null, checklist_template_id: null });
    setForm({ name: '', address: '', email: '', phone: '', default_duration_minutes: 90, default_staff_count: 1, notes: '' });
    setShowAdd(false);
  };

  const handleEdit = (client: SavedClient) => {
    setEditingId(client.id);
    setForm({ name: client.name, address: client.address, email: client.email || '', phone: client.phone || '', default_duration_minutes: client.default_duration_minutes, default_staff_count: client.default_staff_count, notes: client.notes || '' });
  };

  const handleUpdate = async () => {
    if (!editingId) return;
    await updateClient(editingId, form);
    setEditingId(null);
    setForm({ name: '', address: '', email: '', phone: '', default_duration_minutes: 90, default_staff_count: 1, notes: '' });
  };

  const assignTemplate = useCallback(async (clientId: string, templateId: string | null) => {
    await updateClient(clientId, { checklist_template_id: templateId } as Partial<SavedClient>);
  }, [updateClient]);

  if (loading) return <div className="p-6 space-y-3">{[1,2,3].map(i => <div key={i} className="shimmer h-20 rounded-xl" />)}</div>;

  return (
    <div className="h-full overflow-y-auto p-4 lg:p-6 custom-scrollbar">
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
                <div><label className="block text-xs font-medium text-text-secondary mb-1">Default Duration (min)</label>
                  <input type="number" value={form.default_duration_minutes} onChange={(e) => setForm({...form, default_duration_minutes: Number(e.target.value)})} className="input-field text-sm" /></div>
                <div><label className="block text-xs font-medium text-text-secondary mb-1">Default Staff Count</label>
                  <input type="number" value={form.default_staff_count} onChange={(e) => setForm({...form, default_staff_count: Number(e.target.value)})} className="input-field text-sm" min={1} /></div>
              </div>
              <div><label className="block text-xs font-medium text-text-secondary mb-1">Notes</label>
                <textarea value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})} className="input-field text-sm resize-none" rows={2} placeholder="Access codes, special instructions..." /></div>
              <div className="flex gap-2">
                <button onClick={editingId ? handleUpdate : handleAdd} className="btn-primary text-sm">{editingId ? 'Save Changes' : 'Add Client'}</button>
                <button onClick={() => { setShowAdd(false); setEditingId(null); setForm({ name: '', address: '', email: '', phone: '', default_duration_minutes: 90, default_staff_count: 1, notes: '' }); }} className="btn-ghost text-sm">Cancel</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="space-y-2">
          {filtered.map((client, i) => (
            <motion.div key={client.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
              className="card p-4 group">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-bold text-text-primary">{client.name}</h4>
                  <p className="text-xs text-text-tertiary truncate mt-0.5">{client.address}</p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-text-secondary">
                    <span>{client.default_duration_minutes} min</span>
                    <span>·</span>
                    <span>{client.default_staff_count} staff</span>
                    {client.email && <><span>·</span><span>{client.email}</span></>}
                    {client.phone && <><span>·</span><span>{client.phone}</span></>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                  {templates.length > 0 && (
                    <select value={client.checklist_template_id || ''} onChange={(e) => assignTemplate(client.id, e.target.value || null)}
                      className="text-xs bg-surface-elevated border border-border-light rounded-lg px-2 py-1.5 outline-none">
                      <option value="">No checklist</option>
                      {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  )}
                  <button onClick={() => handleEdit(client)} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary hover:text-primary transition-colors" title="Edit">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button onClick={() => deleteClient(client.id)} className="p-1.5 rounded-lg hover:bg-danger-light text-text-tertiary hover:text-danger transition-colors" title="Delete">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
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
