'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';

interface StaffMember { id: string; org_id: string; name: string; email: string; phone: string; role: string; }

export default function StaffPage() {
  const { profile } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: 'cleaner' });

  const loadStaff = useCallback(async () => {
    if (!profile?.org_id) return;
    const { data } = await supabase.from('staff_members').select('*').eq('org_id', profile.org_id).order('name');
    if (data) setStaff(data);
    setLoading(false);
  }, [supabase, profile?.org_id]);

  useEffect(() => { if (profile?.org_id) loadStaff(); }, [profile?.org_id, loadStaff]);

  const handleSave = async () => {
    if (!profile?.org_id || !form.name.trim()) return;
    if (editingId) {
      await supabase.from('staff_members').update(form).eq('id', editingId);
      setStaff((p) => p.map((s) => s.id === editingId ? { ...s, ...form } : s));
      setEditingId(null);
    } else {
      const { data } = await supabase.from('staff_members').insert({ ...form, org_id: profile.org_id }).select().single();
      if (data) setStaff((p) => [...p, data].sort((a, b) => a.name.localeCompare(b.name)));
      setShowAdd(false);
    }
    setForm({ name: '', email: '', phone: '', role: 'cleaner' });
  };

  const handleEdit = (s: StaffMember) => { setEditingId(s.id); setForm({ name: s.name, email: s.email, phone: s.phone, role: s.role }); };
  const handleDelete = async (id: string) => { await supabase.from('staff_members').delete().eq('id', id); setStaff((p) => p.filter((s) => s.id !== id)); };

  if (loading) return <div className="p-6 space-y-3">{[1,2,3].map(i => <div key={i} className="shimmer h-20 rounded-xl" />)}</div>;

  return (
    <div className="h-full overflow-y-auto p-4 lg:p-6 custom-scrollbar">
      <div className="max-w-[700px] mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div><h2 className="text-lg font-bold text-text-primary">Staff</h2><p className="text-sm text-text-secondary">{staff.length} team members</p></div>
          <button onClick={() => { setShowAdd(true); setEditingId(null); setForm({ name: '', email: '', phone: '', role: 'cleaner' }); }} className="btn-primary text-sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Staff
          </button>
        </div>

        <AnimatePresence>
          {(showAdd || editingId) && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="card-elevated p-5 space-y-4 overflow-hidden">
              <h3 className="text-sm font-bold text-text-primary">{editingId ? 'Edit Staff' : 'New Staff Member'}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="block text-xs font-medium text-text-secondary mb-1">Name</label>
                  <input type="text" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} className="input-field text-sm" placeholder="Full name" /></div>
                <div><label className="block text-xs font-medium text-text-secondary mb-1">Role</label>
                  <select value={form.role} onChange={(e) => setForm({...form, role: e.target.value})} className="input-field text-sm">
                    <option value="cleaner">Cleaner</option><option value="supervisor">Supervisor</option><option value="driver">Driver</option><option value="other">Other</option>
                  </select></div>
                <div><label className="block text-xs font-medium text-text-secondary mb-1">Email</label>
                  <input type="email" value={form.email} onChange={(e) => setForm({...form, email: e.target.value})} className="input-field text-sm" placeholder="email@example.com" /></div>
                <div><label className="block text-xs font-medium text-text-secondary mb-1">Phone</label>
                  <input type="tel" value={form.phone} onChange={(e) => setForm({...form, phone: e.target.value})} className="input-field text-sm" placeholder="0400 000 000" /></div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleSave} className="btn-primary text-sm">{editingId ? 'Save Changes' : 'Add Staff'}</button>
                <button onClick={() => { setShowAdd(false); setEditingId(null); }} className="btn-ghost text-sm">Cancel</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="space-y-2">
          {staff.map((s, i) => (
            <motion.div key={s.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="card p-4 group">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary-light flex items-center justify-center text-sm font-bold text-primary">{s.name.charAt(0).toUpperCase()}</div>
                  <div>
                    <h4 className="text-sm font-bold text-text-primary">{s.name}</h4>
                    <div className="flex items-center gap-2 text-xs text-text-tertiary mt-0.5">
                      <span className="capitalize">{s.role}</span>
                      {s.email && <><span>·</span><span>{s.email}</span></>}
                      {s.phone && <><span>·</span><span>{s.phone}</span></>}
                    </div>
                  </div>
                </div>
                <div className="flex gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                  <button onClick={() => handleEdit(s)} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary hover:text-primary"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                  <button onClick={() => handleDelete(s.id)} className="p-1.5 rounded-lg hover:bg-danger-light text-text-tertiary hover:text-danger"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
                </div>
              </div>
            </motion.div>
          ))}
          {staff.length === 0 && <div className="text-center py-12"><p className="text-text-tertiary text-sm">No staff members yet.</p></div>}
        </div>
      </div>
    </div>
  );
}
