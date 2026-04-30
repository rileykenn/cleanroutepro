'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';

interface StaffMember { id: string; org_id: string; name: string; email: string; phone: string; role: string; }
interface StaffAssignment { id: string; staff_id: string; team_id: string; assignment_date: string; is_available: boolean; }
interface Team { id: string; name: string; color_index: number; }

const TEAM_COLORS_HEX = ['#4F46E5', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6'];

export default function StaffPage() {
  const { profile } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [assignments, setAssignments] = useState<StaffAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: 'cleaner' });
  const [rosterDate, setRosterDate] = useState(() => {
    const d = new Date();
    return d.toISOString().split('T')[0];
  });

  const loadStaff = useCallback(async () => {
    if (!profile?.org_id) return;
    const { data } = await supabase.from('staff_members').select('*').eq('org_id', profile.org_id).order('name');
    if (data) setStaff(data);
    setLoading(false);
  }, [supabase, profile?.org_id]);

  const loadTeams = useCallback(async () => {
    if (!profile?.org_id) return;
    const { data } = await supabase.from('teams').select('id, name, color_index').eq('org_id', profile.org_id).order('sort_order');
    if (data) setTeams(data);
  }, [supabase, profile?.org_id]);

  const loadAssignments = useCallback(async () => {
    if (!profile?.org_id) return;
    const { data } = await supabase.from('staff_assignments').select('*').eq('org_id', profile.org_id).eq('assignment_date', rosterDate);
    if (data) setAssignments(data);
  }, [supabase, profile?.org_id, rosterDate]);

  useEffect(() => {
    if (profile?.org_id) {
      loadStaff();
      loadTeams();
    }
  }, [profile?.org_id, loadStaff, loadTeams]);

  useEffect(() => { if (profile?.org_id) loadAssignments(); }, [profile?.org_id, rosterDate, loadAssignments]);

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
  const handleDelete = async (id: string) => {
    await supabase.from('staff_assignments').delete().eq('staff_id', id);
    await supabase.from('staff_members').delete().eq('id', id);
    setStaff((p) => p.filter((s) => s.id !== id));
  };

  // ─── Roster assignment logic ───
  const getAssignment = (staffId: string) => assignments.find((a) => a.staff_id === staffId);

  const assignToTeam = async (staffId: string, teamId: string | null) => {
    if (!profile?.org_id) return;
    const existing = getAssignment(staffId);

    if (teamId === null) {
      // Remove assignment
      if (existing) {
        await supabase.from('staff_assignments').delete().eq('id', existing.id);
        setAssignments((p) => p.filter((a) => a.id !== existing.id));
      }
      return;
    }

    if (existing) {
      await supabase.from('staff_assignments').update({ team_id: teamId }).eq('id', existing.id);
      setAssignments((p) => p.map((a) => a.id === existing.id ? { ...a, team_id: teamId } : a));
    } else {
      const { data } = await supabase.from('staff_assignments').insert({
        org_id: profile.org_id, staff_id: staffId, team_id: teamId, assignment_date: rosterDate, is_available: true,
      }).select().single();
      if (data) setAssignments((p) => [...p, data]);
    }
  };

  const toggleAvailability = async (staffId: string) => {
    if (!profile?.org_id) return;
    const existing = getAssignment(staffId);
    if (existing) {
      const newVal = !existing.is_available;
      await supabase.from('staff_assignments').update({ is_available: newVal }).eq('id', existing.id);
      setAssignments((p) => p.map((a) => a.id === existing.id ? { ...a, is_available: newVal } : a));
    } else {
      // Create a "unavailable" entry (no team assigned)
      const { data } = await supabase.from('staff_assignments').insert({
        org_id: profile.org_id, staff_id: staffId, team_id: teams[0]?.id || null, assignment_date: rosterDate, is_available: false,
      }).select().single();
      if (data) setAssignments((p) => [...p, data]);
    }
  };

  const formatDateNice = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = d.getTime() - today.getTime();
    const days = Math.round(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days === -1) return 'Yesterday';
    return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  };

  if (loading) return <div className="p-6 space-y-3">{[1,2,3].map(i => <div key={i} className="shimmer h-20 rounded-xl" />)}</div>;

  return (
    <div className="h-full overflow-y-auto p-4 lg:p-6 custom-scrollbar">
      <div className="max-w-[800px] mx-auto space-y-6">
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

        {/* Staff Directory */}
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

        {/* ─── Daily Roster ─── */}
        {staff.length > 0 && teams.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <div className="card-elevated p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                      <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
                      <line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-text-primary">Daily Roster</h3>
                    <p className="text-xs text-text-tertiary">{formatDateNice(rosterDate)}</p>
                  </div>
                </div>
                <input
                  type="date"
                  value={rosterDate}
                  onChange={(e) => setRosterDate(e.target.value)}
                  className="text-sm font-medium bg-surface-elevated border border-border-light rounded-lg px-3 py-1.5 outline-none focus:border-primary"
                />
              </div>

              {/* Team legend */}
              <div className="flex flex-wrap gap-2 mb-4">
                {teams.map((t) => {
                  const count = assignments.filter((a) => a.team_id === t.id && a.is_available).length;
                  return (
                    <div key={t.id} className="flex items-center gap-1.5 text-xs font-medium text-text-secondary bg-surface-elevated px-2.5 py-1.5 rounded-lg">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: TEAM_COLORS_HEX[t.color_index % TEAM_COLORS_HEX.length] }} />
                      {t.name}
                      <span className="font-bold text-text-primary">{count}</span>
                    </div>
                  );
                })}
              </div>

              {/* Roster grid */}
              <div className="space-y-2">
                {staff.map((s) => {
                  const assignment = getAssignment(s.id);
                  const isAvailable = assignment ? assignment.is_available : true;
                  return (
                    <div key={s.id} className={`flex items-center justify-between gap-3 p-3 rounded-xl border transition-colors ${
                      !isAvailable ? 'bg-red-50/50 border-red-100' : assignment ? 'bg-surface-elevated border-border-light' : 'bg-white border-border-light'
                    }`}>
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                          isAvailable ? 'bg-primary-light text-primary' : 'bg-red-100 text-red-400'
                        }`}>
                          {s.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <span className={`text-sm font-medium ${!isAvailable ? 'text-text-tertiary line-through' : 'text-text-primary'}`}>{s.name}</span>
                          <span className="text-xs text-text-tertiary ml-1.5 capitalize">{s.role}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {isAvailable && (
                          <select
                            value={assignment?.team_id || ''}
                            onChange={(e) => assignToTeam(s.id, e.target.value || null)}
                            className="text-xs font-medium bg-white border border-border-light rounded-lg px-2 py-1.5 outline-none focus:border-primary cursor-pointer"
                          >
                            <option value="">Unassigned</option>
                            {teams.map((t) => (
                              <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                          </select>
                        )}
                        <button
                          onClick={() => toggleAvailability(s.id)}
                          className={`p-1.5 rounded-lg transition-colors text-xs font-medium ${
                            isAvailable
                              ? 'hover:bg-red-50 text-text-tertiary hover:text-red-500'
                              : 'bg-red-100 text-red-500 hover:bg-red-200'
                          }`}
                          title={isAvailable ? 'Mark unavailable' : 'Mark available'}
                        >
                          {isAvailable ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
