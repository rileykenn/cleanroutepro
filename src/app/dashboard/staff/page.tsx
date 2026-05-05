'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';

interface StaffMember {
  id: string; org_id: string; name: string; email: string; phone: string; role: string;
  available_days: number[] | null;
  hourly_rate: number;
  user_id: string | null;
  invite_status: string;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WORK_DAYS = [1, 2, 3, 4, 5]; // Mon–Fri default

export default function StaffPage() {
  const { profile } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: 'cleaner', hourly_rate: 38 });
  const [inviting, setInviting] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

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
      const { data } = await supabase.from('staff_members').insert({
        ...form, org_id: profile.org_id, available_days: WORK_DAYS,
      }).select().single();
      if (data) setStaff((p) => [...p, data].sort((a, b) => a.name.localeCompare(b.name)));
      setShowAdd(false);
    }
    setForm({ name: '', email: '', phone: '', role: 'cleaner', hourly_rate: 38 });
  };

  const handleEdit = (s: StaffMember) => {
    setEditingId(s.id);
    setForm({ name: s.name, email: s.email, phone: s.phone, role: s.role, hourly_rate: s.hourly_rate || 38 });
  };

  const handleDelete = async (id: string) => {
    await supabase.from('staff_assignments').delete().eq('staff_id', id);
    await supabase.from('staff_members').delete().eq('id', id);
    setStaff((p) => p.filter((s) => s.id !== id));
  };

  const toggleDay = async (staffId: string, dayNum: number) => {
    const member = staff.find((s) => s.id === staffId);
    if (!member) return;
    const current = member.available_days ?? [0, 1, 2, 3, 4, 5, 6];
    const updated = current.includes(dayNum)
      ? current.filter((d) => d !== dayNum)
      : [...current, dayNum].sort();
    await supabase.from('staff_members').update({ available_days: updated }).eq('id', staffId);
    setStaff((p) => p.map((s) => s.id === staffId ? { ...s, available_days: updated } : s));
  };

  const handleInvite = async (s: StaffMember) => {
    if (!s.email) {
      setInviteError(`${s.name} needs an email address first. Edit their profile to add one.`);
      setTimeout(() => setInviteError(null), 4000);
      return;
    }
    setInviting(s.id);
    setInviteError(null);
    setInviteSuccess(null);

    try {
      const res = await fetch('/api/staff/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffMemberId: s.id, email: s.email, name: s.name }),
      });
      const data = await res.json();

      if (!res.ok) {
        setInviteError(data.error || 'Failed to send invite');
        setTimeout(() => setInviteError(null), 4000);
      } else {
        setInviteSuccess(`Invite sent to ${s.email}`);
        setStaff(prev => prev.map(m => m.id === s.id ? { ...m, invite_status: 'pending' } : m));
        setTimeout(() => setInviteSuccess(null), 4000);
      }
    } catch {
      setInviteError('Network error — please try again');
      setTimeout(() => setInviteError(null), 4000);
    }
    setInviting(null);
  };

  if (loading) return <div className="p-6 space-y-3">{[1,2,3].map(i => <div key={i} className="shimmer h-20 rounded-xl" />)}</div>;

  return (
    <div className="h-full overflow-y-auto p-4 lg:p-6 custom-scrollbar">
      <div className="max-w-[800px] mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-text-primary">Staff</h2>
            <p className="text-sm text-text-secondary">{staff.length} team member{staff.length !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={() => { setShowAdd(true); setEditingId(null); setForm({ name: '', email: '', phone: '', role: 'cleaner', hourly_rate: 38 }); }} className="btn-primary text-sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Staff
          </button>
        </div>

        {/* Status messages */}
        <AnimatePresence>
          {inviteError && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="text-sm text-danger bg-danger-light rounded-lg p-3">{inviteError}</motion.div>
          )}
          {inviteSuccess && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="text-sm text-emerald-700 bg-emerald-50 rounded-lg p-3 border border-emerald-200">{inviteSuccess}</motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {(showAdd || editingId) && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="card-elevated p-5 space-y-4 overflow-hidden">
              <h3 className="text-sm font-bold text-text-primary">{editingId ? 'Edit Staff' : 'New Staff Member'}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="block text-xs font-medium text-text-secondary mb-1">Name</label>
                  <input type="text" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} className="input-field text-sm" placeholder="Full name" /></div>
                <div><label className="block text-xs font-medium text-text-secondary mb-1">Role</label>
                  <select value={form.role} onChange={(e) => setForm({...form, role: e.target.value})} className="input-field text-sm">
                    <option value="cleaner">Cleaner</option><option value="supervisor">Supervisor</option><option value="driver">Driver</option><option value="trainee">Trainee</option><option value="other">Other</option>
                  </select></div>
                <div><label className="block text-xs font-medium text-text-secondary mb-1">Email</label>
                  <input type="email" value={form.email} onChange={(e) => setForm({...form, email: e.target.value})} className="input-field text-sm" placeholder="email@example.com" /></div>
                <div><label className="block text-xs font-medium text-text-secondary mb-1">Phone</label>
                  <input type="tel" value={form.phone} onChange={(e) => setForm({...form, phone: e.target.value})} className="input-field text-sm" placeholder="0400 000 000" /></div>
                <div><label className="block text-xs font-medium text-text-secondary mb-1">Hourly Rate</label>
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-text-tertiary">$</span>
                    <input type="number" value={form.hourly_rate} onChange={(e) => setForm({...form, hourly_rate: parseFloat(e.target.value) || 0})} className="input-field text-sm" min={0} step={0.5} />
                    <span className="text-xs text-text-tertiary">/hr</span>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleSave} className="btn-primary text-sm">{editingId ? 'Save Changes' : 'Add Staff'}</button>
                <button onClick={() => { setShowAdd(false); setEditingId(null); }} className="btn-ghost text-sm">Cancel</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Staff Directory */}
        <div className="space-y-2">
          {staff.map((s, i) => {
            const days = s.available_days ?? [0, 1, 2, 3, 4, 5, 6];
            const hasAccount = s.invite_status === 'accepted';
            const isPending = s.invite_status === 'pending';
            return (
              <motion.div key={s.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="card p-4 group">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-primary-light flex items-center justify-center text-sm font-bold text-primary shrink-0">{s.name.charAt(0).toUpperCase()}</div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-text-primary">{s.name}</h4>
                        {hasAccount && (
                          <span className="text-[10px] font-medium bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-200">
                            Account Active
                          </span>
                        )}
                        {isPending && (
                          <span className="text-[10px] font-medium bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded border border-amber-200">
                            Invite Pending
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-text-tertiary mt-0.5 flex-wrap">
                        <span className="capitalize">{s.role}</span>
                        {s.email && <><span>·</span><span>{s.email}</span></>}
                        {s.phone && <><span>·</span><span>{s.phone}</span></>}
                        <span>·</span><span className="font-medium text-emerald-600">${s.hourly_rate || 38}/hr</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity shrink-0">
                    {/* Invite button — only if no account yet */}
                    {!hasAccount && !isPending && (
                      <button onClick={() => handleInvite(s)} disabled={inviting === s.id}
                        className="p-1.5 rounded-lg hover:bg-primary-light text-text-tertiary hover:text-primary transition-colors disabled:opacity-50" title="Send login invite">
                        {inviting === s.id ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                        )}
                      </button>
                    )}
                    {isPending && (
                      <button onClick={() => handleInvite(s)} disabled={inviting === s.id}
                        className="p-1.5 rounded-lg hover:bg-amber-50 text-amber-500 hover:text-amber-600 transition-colors disabled:opacity-50" title="Resend invite">
                        {inviting === s.id ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                        )}
                      </button>
                    )}
                    <button onClick={() => handleEdit(s)} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary hover:text-primary"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                    <button onClick={() => handleDelete(s.id)} className="p-1.5 rounded-lg hover:bg-danger-light text-text-tertiary hover:text-danger"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
                  </div>
                </div>

                {/* Availability Days */}
                <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-border-light">
                  <span className="text-[10px] font-medium text-text-tertiary mr-1 uppercase tracking-wider">Available</span>
                  {DAY_LABELS.map((label, dayNum) => {
                    const isActive = days.includes(dayNum);
                    return (
                      <button
                        key={dayNum}
                        onClick={() => toggleDay(s.id, dayNum)}
                        className={`w-8 h-7 rounded-md text-[10px] font-bold transition-all ${
                          isActive
                            ? 'bg-primary text-white shadow-sm'
                            : 'bg-surface-elevated text-text-tertiary hover:bg-surface-hover'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            );
          })}
          {staff.length === 0 && <div className="text-center py-12"><p className="text-text-tertiary text-sm">No staff members yet.</p></div>}
        </div>
      </div>
    </div>
  );
}
