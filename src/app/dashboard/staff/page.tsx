'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';

interface StaffMember {
  id: string;
  org_id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  available_days: number[] | null;
  hourly_rate: number;
  user_id: string | null;
  invite_status: string | null;
}

/** A real account holder — sourced from org_members + profiles */
interface OrgAccount {
  membershipId: string;
  userId: string;
  fullName: string;
  email: string;
  orgRole: 'admin' | 'staff';
  memberStatus: string;
  staffMemberId: string | null;
  staffName: string | null;
  staffRole: string | null;
  /** True when the linked staff_members row was deleted but org_members wasn’t cleaned up */
  isOrphaned: boolean;
}

type ConfirmAction =
  | { type: 'revoke'; staff: StaffMember }
  | { type: 'delete'; staff: StaffMember };

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WORK_DAYS = [1, 2, 3, 4, 5];

// ─── Status badge ───────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string | null }) {
  if (status === 'accepted') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
        Active account
      </span>
    );
  }
  if (status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full border border-amber-200">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block animate-pulse" />
        Invite pending
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-surface-elevated text-text-tertiary px-2 py-0.5 rounded-full border border-border-light">
      No account
    </span>
  );
}

// ─── Confirmation Modal ─────────────────────────────────────────────────────
function ConfirmModal({
  action,
  onConfirm,
  onCancel,
  loading,
}: {
  action: ConfirmAction;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const isRevoke = action.type === 'revoke';
  const staffName = action.staff.name;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        onClick={e => e.stopPropagation()}
        className="relative bg-white rounded-2xl w-full max-w-[420px] p-6 shadow-2xl"
      >
        {/* Icon */}
        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 ${
          isRevoke ? 'bg-amber-50' : 'bg-danger-light'
        }`}>
          {isRevoke ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2">
              <path d="M18.36 6.64A9 9 0 0 1 20.77 15M6.16 6.16a9 9 0 1 0 12.68 12.68M2 2l20 20"/>
              <path d="M18 8h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2"/>
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              <line x1="10" y1="11" x2="10" y2="17"/>
              <line x1="14" y1="11" x2="14" y2="17"/>
            </svg>
          )}
        </div>

        <h3 className="text-lg font-bold text-text-primary mb-1">
          {isRevoke ? 'Revoke portal access?' : `Remove ${staffName}?`}
        </h3>

        <p className="text-sm text-text-secondary mb-5 leading-relaxed">
          {isRevoke ? (
            <>
              <span className="font-semibold text-text-primary">{staffName}</span> will immediately
              lose access to the staff portal. Their staff record stays in the roster — you can
              re-invite them later. If they have no other organisations, their login account will
              also be deleted.
            </>
          ) : (
            <>
              This will permanently remove{' '}
              <span className="font-semibold text-text-primary">{staffName}</span> from the roster
              and revoke any portal access.
              {action.staff.user_id && (
                <> Their login account will also be deleted if they have no other organisations.</>
              )}
              {' '}This cannot be undone.
            </>
          )}
        </p>

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 btn-secondary text-sm py-2.5"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 text-sm py-2.5 rounded-xl font-semibold transition-all disabled:opacity-60 ${
              isRevoke
                ? 'bg-amber-500 text-white hover:bg-amber-600'
                : 'bg-danger text-white hover:bg-red-600'
            }`}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                </svg>
                {isRevoke ? 'Revoking...' : 'Removing...'}
              </span>
            ) : (
              isRevoke ? 'Revoke access' : 'Remove staff'
            )}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────
export default function StaffPage() {
  const { profile } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<'roster' | 'accounts'>('roster');

  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editFormRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: 'cleaner', hourly_rate: 38 });

  // Accounts & Access — sourced from org_members (the real source of truth)
  const [orgAccounts, setOrgAccounts] = useState<OrgAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);

  const [inviting, setInviting] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [confirmOrgRevoke, setConfirmOrgRevoke] = useState<OrgAccount | null>(null);

  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const loadStaff = useCallback(async () => {
    if (!profile?.org_id) return;
    const { data } = await supabase
      .from('staff_members').select('*').eq('org_id', profile.org_id).order('name');

    if (data) {
      // ── Self-heal: fix stale invite_status values ─────────────────────
      // A staff member whose user accepted via email link may still show
      // 'pending' because the confirm route previously didn't sync the status.
      // Cross-check org_members and heal silently.
      const stale = data.filter(
        (s: StaffMember) => s.user_id && s.invite_status !== 'accepted'
      );
      if (stale.length > 0) {
        const { data: accepted } = await supabase
          .from('org_members')
          .select('staff_member_id')
          .eq('org_id', profile.org_id)
          .eq('status', 'accepted')
          .in('staff_member_id', stale.map((s: StaffMember) => s.id));

        const acceptedIds = new Set((accepted || []).map((m: { staff_member_id: string }) => m.staff_member_id));
        if (acceptedIds.size > 0) {
          // Batch-update the stale rows in DB
          await Promise.all(
            stale
              .filter((s: StaffMember) => acceptedIds.has(s.id))
              .map((s: StaffMember) =>
                supabase
                  .from('staff_members')
                  .update({ invite_status: 'accepted' })
                  .eq('id', s.id)
              )
          );
          // Patch local state so UI updates immediately
          data.forEach((s: StaffMember) => {
            if (acceptedIds.has(s.id)) s.invite_status = 'accepted';
          });
        }
      }
      // ─────────────────────────────────────────────────────────────────

      setStaff(data);
    }
    setLoading(false);
  }, [supabase, profile?.org_id]);

  // Load org_members — the real source of truth for who has portal access
  const loadAccounts = useCallback(async () => {
    if (!profile?.org_id) return;
    setAccountsLoading(true);

    // All accepted + pending members of this org
    const { data: memberships } = await supabase
      .from('org_members')
      .select('id, user_id, role, status, staff_member_id')
      .eq('org_id', profile.org_id)
      .in('status', ['accepted', 'pending']);

    if (!memberships || memberships.length === 0) {
      setOrgAccounts([]);
      setAccountsLoading(false);
      return;
    }

    type RawMembership = { id: string; user_id: string; role: string; status: string; staff_member_id: string | null };
    const rows = memberships as RawMembership[];
    const userIds = rows.map(m => m.user_id);
    const staffIds = rows.map(m => m.staff_member_id).filter(Boolean) as string[];

    // Fetch profiles for display names/emails
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', userIds);

    // Fetch linked staff_members for role/name
    const { data: linkedStaff } = staffIds.length > 0
      ? await supabase.from('staff_members').select('id, name, role').in('id', staffIds)
      : { data: [] };

    type RawProfile = { id: string; full_name: string | null; email: string | null };
    type RawStaff = { id: string; name: string; role: string };
    const profileMap = new Map((profiles as RawProfile[] || []).map(p => [p.id, p]));
    const staffMap = new Map((linkedStaff as RawStaff[] || []).map(s => [s.id, s]));

    const accounts: OrgAccount[] = rows.map(m => {
      const prof = profileMap.get(m.user_id);
      const sm = m.staff_member_id ? staffMap.get(m.staff_member_id) : undefined;
      // Fall back to email when profile name is missing (e.g. orphaned account whose
      // staff_members row was deleted before the org_members row was cleaned up)
      const email = prof?.email || '';
      const emailFallback = email ? email.split('@')[0] : null;
      const fullName = sm?.name || prof?.full_name || emailFallback || 'Unknown account';
      return {
        membershipId: m.id,
        userId: m.user_id,
        fullName,
        email,
        orgRole: (m.role === 'admin' ? 'admin' : 'staff') as 'admin' | 'staff',
        memberStatus: m.status,
        staffMemberId: m.staff_member_id,
        staffName: sm?.name || null,
        staffRole: sm?.role || null,
        isOrphaned: !sm && !prof?.full_name, // staff_members row was deleted
      };
    });

    // Sort: admins first, then alphabetically
    accounts.sort((a, b) => {
      if (a.orgRole !== b.orgRole) return a.orgRole === 'admin' ? -1 : 1;
      return a.fullName.localeCompare(b.fullName);
    });

    setOrgAccounts(accounts);
    setAccountsLoading(false);
  }, [supabase, profile?.org_id]);

  useEffect(() => { if (profile?.org_id) loadStaff(); }, [profile?.org_id, loadStaff]);
  useEffect(() => { if (profile?.org_id && activeSection === 'accounts') loadAccounts(); }, [profile?.org_id, activeSection, loadAccounts]);

  // Scroll to edit form when editingId changes
  useEffect(() => {
    if (editingId) {
      // Small delay to allow AnimatePresence to render the form
      setTimeout(() => {
        editFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [editingId]);

  // ── Add / Edit ─────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!profile?.org_id || !form.name.trim()) return;
    if (editingId) {
      await supabase.from('staff_members').update(form).eq('id', editingId);
      setStaff(p => p.map(s => s.id === editingId ? { ...s, ...form } : s));
      setEditingId(null);
    } else {
      const { data } = await supabase.from('staff_members').insert({
        ...form, org_id: profile.org_id, available_days: WORK_DAYS,
      }).select().single();
      if (data) setStaff(p => [...p, data].sort((a, b) => a.name.localeCompare(b.name)));
      setShowAdd(false);
    }
    setForm({ name: '', email: '', phone: '', role: 'cleaner', hourly_rate: 38 });
  };

  const handleEdit = (s: StaffMember) => {
    setEditingId(s.id);
    setForm({ name: s.name, email: s.email || '', phone: s.phone || '', role: s.role, hourly_rate: s.hourly_rate || 38 });
    setActiveSection('roster');
  };

  // ── Availability toggles ───────────────────────────────────────────────
  const toggleDay = async (staffId: string, dayNum: number) => {
    const member = staff.find(s => s.id === staffId);
    if (!member) return;
    const current = member.available_days ?? [0, 1, 2, 3, 4, 5, 6];
    const updated = current.includes(dayNum)
      ? current.filter(d => d !== dayNum)
      : [...current, dayNum].sort();
    await supabase.from('staff_members').update({ available_days: updated }).eq('id', staffId);
    setStaff(p => p.map(s => s.id === staffId ? { ...s, available_days: updated } : s));
  };

  // ── Invite ─────────────────────────────────────────────────────────────
  const handleInvite = async (s: StaffMember) => {
    if (!s.email) {
      showToast('error', `${s.name} needs an email address. Edit their profile first.`);
      return;
    }
    setInviting(s.id);
    try {
      const res = await fetch('/api/staff/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffMemberId: s.id, email: s.email, name: s.name }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast('error', data.error || 'Failed to send invite');
      } else {
        showToast('success', `Invite sent to ${s.email}`);
        setStaff(prev => prev.map(m => m.id === s.id ? { ...m, invite_status: 'pending' } : m));
      }
    } catch {
      showToast('error', 'Network error — please try again');
    }
    setInviting(null);
  };

  // ── Revoke / Delete ────────────────────────────────────────────────────
  const handleConfirm = async () => {
    if (!confirmAction) return;
    setActionLoading(true);

    const { staff: s, type } = confirmAction;
    const revokeAccountOnly = type === 'revoke';

    try {
      const res = await fetch('/api/staff/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffMemberId: s.id, revokeAccountOnly }),
      });
      const data = await res.json();

      if (!res.ok) {
        showToast('error', data.error || 'Something went wrong');
      } else {
        if (revokeAccountOnly) {
          // Reset invite status but keep in roster
          setStaff(prev => prev.map(m => m.id === s.id ? { ...m, user_id: null, invite_status: null } : m));
          showToast('success', `${s.name}'s portal access has been revoked`);
        } else {
          // Remove from list entirely
          setStaff(prev => prev.filter(m => m.id !== s.id));
          showToast('success', `${s.name} has been removed`);
        }
        // Refresh the accounts list from org_members
        loadAccounts();
      }
    } catch {
      showToast('error', 'Network error — please try again');
    }

    setActionLoading(false);
    setConfirmAction(null);
  };

  // Revoke an org account directly by membershipId (for admin accounts not in staff_members)
  const handleRevokeOrgAccount = async (account: OrgAccount) => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/staff/remove-org-member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ membershipId: account.membershipId }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast('error', data.error || 'Something went wrong');
      } else {
        showToast('success', `${account.fullName}'s access has been revoked`);
        loadAccounts();
        loadStaff();
      }
    } catch {
      showToast('error', 'Network error — please try again');
    }
    setActionLoading(false);
    setConfirmOrgRevoke(null);
  };

  // ── Derived data ───────────────────────────────────────────────────────────
  // Accounts tab: sourced from org_members (accurate)
  const activeAccounts = orgAccounts.filter(a => a.memberStatus === 'accepted');
  const pendingAccounts = orgAccounts.filter(a => a.memberStatus === 'pending');
  // Staff without any account: in staff_members but NOT in org_members
  const staffWithAccount = new Set(orgAccounts.map(a => a.staffMemberId).filter(Boolean));
  const noAccount = staff.filter(s => !staffWithAccount.has(s.id));

  if (loading) {
    return (
      <div className="p-6 space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="shimmer h-20 rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="max-w-[860px] mx-auto px-4 lg:px-6 py-6 pb-20 lg:pb-6 space-y-6">

        {/* ── Page header ──────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-text-primary">Staff</h1>
            <p className="text-sm text-text-secondary mt-0.5">
              {staff.length} member{staff.length !== 1 ? 's' : ''} ·{' '}
              {activeAccounts.length} with portal access
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/dashboard/staff/payroll" className="btn-secondary text-sm">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Payroll
            </Link>
            <button
              onClick={() => { setShowAdd(true); setEditingId(null); setForm({ name: '', email: '', phone: '', role: 'cleaner', hourly_rate: 38 }); setActiveSection('roster'); }}
              className="btn-primary text-sm"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Add Staff
            </button>
          </div>
        </div>

        {/* ── Toast notification ────────────────────────────────────────── */}
        <AnimatePresence>
          {toast && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className={`flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm font-medium ${
                toast.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-danger-light text-danger border border-red-200'
              }`}
            >
              {toast.type === 'success' ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5">
                  <path d="M20 6L9 17l-5-5"/>
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              )}
              {toast.message}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Segment control ───────────────────────────────────────────── */}
        <div className="flex gap-1 p-1 bg-surface-elevated rounded-xl w-fit border border-border-light">
          {([
            { id: 'roster', label: 'Roster', count: staff.length },
            { id: 'accounts', label: 'Accounts & Access', count: activeAccounts.length + pendingAccounts.length },
          ] as const).map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveSection(tab.id)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                activeSection === tab.id
                  ? 'bg-white text-text-primary shadow-sm border border-border-light'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className={`ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  activeSection === tab.id ? 'bg-primary text-white' : 'bg-border text-text-tertiary'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">

          {/* ═══════════════════ ROSTER TAB ═══════════════════════════════ */}
          {activeSection === 'roster' && (
            <motion.div
              key="roster"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              {/* Add / Edit form */}
              <AnimatePresence>
                {(showAdd || editingId) && (
                  <motion.div
                    ref={editFormRef}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="card-elevated p-5 space-y-4 overflow-hidden"
                  >
                    <h3 className="text-sm font-bold text-text-primary">
                      {editingId ? 'Edit Staff Member' : 'New Staff Member'}
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1">Name</label>
                        <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="input-field text-sm" placeholder="Full name" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1">Role</label>
                        <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} className="input-field text-sm">
                          <option value="cleaner">Cleaner</option>
                          <option value="supervisor">Supervisor</option>
                          <option value="driver">Driver</option>
                          <option value="trainee">Trainee</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1">Email</label>
                        <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="input-field text-sm" placeholder="email@example.com" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1">Phone</label>
                        <input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="input-field text-sm" placeholder="0400 000 000" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1">Hourly Rate</label>
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm text-text-tertiary">$</span>
                          <input type="number" value={form.hourly_rate} onChange={e => setForm({ ...form, hourly_rate: parseFloat(e.target.value) || 0 })} className="input-field text-sm" min={0} step={0.5} />
                          <span className="text-xs text-text-tertiary whitespace-nowrap">/hr</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={handleSave} className="btn-primary text-sm">
                        {editingId ? 'Save Changes' : 'Add Staff'}
                      </button>
                      <button onClick={() => { setShowAdd(false); setEditingId(null); }} className="btn-ghost text-sm">
                        Cancel
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Staff list */}
              <div className="space-y-2">
                {staff.map((s, i) => {
                  const days = s.available_days ?? [0, 1, 2, 3, 4, 5, 6];
                  const hasAccount = s.invite_status === 'accepted';
                  const isPending = s.invite_status === 'pending';

                  return (
                    <motion.div
                      key={s.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.03 }}
                      className="card p-4 group"
                    >
                      <div className="flex items-start gap-3">
                        {/* Avatar */}
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                          hasAccount ? 'bg-emerald-100 text-emerald-700' : 'bg-primary-light text-primary'
                        }`}>
                          {s.name.charAt(0).toUpperCase()}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-0.5">
                            <h4 className="text-sm font-bold text-text-primary">{s.name}</h4>
                            <StatusBadge status={s.invite_status} />
                          </div>
                          <div className="flex items-center gap-2 text-xs text-text-tertiary flex-wrap">
                            <span className="capitalize">{s.role}</span>
                            {s.email && <><span>·</span><span>{s.email}</span></>}
                            {s.phone && <><span>·</span><span>{s.phone}</span></>}
                            <span>·</span>
                            <span className="font-medium text-emerald-600">${s.hourly_rate || 38}/hr</span>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-1 shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                          {/* Invite / Resend */}
                          {!hasAccount && (
                            <button
                              onClick={() => handleInvite(s)}
                              disabled={inviting === s.id}
                              title={isPending ? 'Resend invite' : 'Send portal invite'}
                              className={`p-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                                isPending
                                  ? 'hover:bg-amber-50 text-amber-500 hover:text-amber-600'
                                  : 'hover:bg-primary-light text-text-tertiary hover:text-primary'
                              }`}
                            >
                              {inviting === s.id ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                                  <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                                </svg>
                              ) : isPending ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                                </svg>
                              ) : (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
                                </svg>
                              )}
                            </button>
                          )}
                          {/* Revoke Access — only for staff with active portal access */}
                          {hasAccount && (
                            <button
                              onClick={() => setConfirmAction({ type: 'revoke', staff: s })}
                              title="Revoke portal access"
                              className="p-1.5 rounded-lg hover:bg-amber-50 text-text-tertiary hover:text-amber-600 transition-colors"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M18.36 6.64A9 9 0 0 1 20.77 15M6.16 6.16a9 9 0 1 0 12.68 12.68M2 2l20 20"/>
                              </svg>
                            </button>
                          )}
                          <button onClick={() => handleEdit(s)} title="Edit" className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary hover:text-primary transition-colors">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                          </button>
                          <button
                            onClick={() => setConfirmAction({ type: 'delete', staff: s })}
                            title="Remove staff member"
                            className="p-1.5 rounded-lg hover:bg-danger-light text-text-tertiary hover:text-danger transition-colors"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6"/>
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                          </button>
                        </div>
                      </div>

                      {/* Availability */}
                      <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-border-light">
                        <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mr-1">Available</span>
                        {DAY_LABELS.map((label, dayNum) => {
                          const isActive = days.includes(dayNum);
                          return (
                            <button
                              key={dayNum}
                              onClick={() => toggleDay(s.id, dayNum)}
                              className={`w-8 h-7 rounded-md text-[10px] font-bold transition-all ${
                                isActive ? 'bg-primary text-white shadow-sm' : 'bg-surface-elevated text-text-tertiary hover:bg-surface-hover'
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

                {staff.length === 0 && (
                  <div className="text-center py-16">
                    <div className="w-14 h-14 rounded-2xl bg-surface-elevated border border-border-light flex items-center justify-center mx-auto mb-3">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-tertiary">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                      </svg>
                    </div>
                    <p className="text-sm font-semibold text-text-secondary">No staff members yet</p>
                    <p className="text-xs text-text-tertiary mt-1">Add your first team member above</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* ═══════════════════ ACCOUNTS TAB ═════════════════════════════ */}
          {activeSection === 'accounts' && (
            <motion.div
              key="accounts"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              {/* Info callout */}
              <div className="flex items-start gap-3 px-4 py-3.5 bg-primary-light rounded-xl border border-primary-border">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2" className="shrink-0 mt-0.5">
                  <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
                </svg>
                <p className="text-xs text-primary leading-relaxed">
                  Everyone listed here has (or had) a login connected to your organisation.
                  <strong> Revoking</strong> removes their portal access but keeps them in the roster.
                  Admins cannot be removed — only their org membership can be revoked.
                </p>
              </div>

              {accountsLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => <div key={i} className="shimmer h-16 rounded-xl" />)}
                </div>
              ) : (
                <>
                  {/* Active accounts */}
                  {activeAccounts.length > 0 && (
                    <div>
                      <h2 className="text-xs font-bold text-text-tertiary uppercase tracking-widest mb-3">
                        Active — {activeAccounts.length}
                      </h2>
                      <div className="space-y-2">
                        {activeAccounts.map((a, i) => {
                          const isMe = a.userId === (profile as { id?: string } | null)?.id;
                          return (
                            <motion.div
                              key={a.membershipId}
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: i * 0.04 }}
                              className="card p-4 flex items-center gap-3"
                            >
                              <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-sm font-bold text-emerald-700 shrink-0">
                                {a.fullName.charAt(0).toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm font-bold text-text-primary">{a.fullName}</p>
                                  {a.orgRole === 'admin' && (
                                    <span className="text-[10px] font-semibold bg-primary-light text-primary px-2 py-0.5 rounded-full border border-primary-border">Admin</span>
                                  )}
                                  {a.isOrphaned && (
                                    <span className="text-[10px] font-semibold bg-red-50 text-red-600 px-2 py-0.5 rounded-full border border-red-200" title="Staff record was deleted but portal access was never revoked">
                                      ⚠ Orphaned
                                    </span>
                                  )}
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                                    Active account
                                  </span>
                                  {isMe && (
                                    <span className="text-[10px] font-semibold text-text-tertiary">(you)</span>
                                  )}
                                </div>
                                <p className="text-xs text-text-tertiary mt-0.5 truncate">
                                  {a.staffRole ? <span className="capitalize">{a.staffRole}</span> : 'Admin'}
                                  {a.email && ` · ${a.email}`}
                                </p>
                              </div>
                              {/* Don't show revoke for yourself */}
                              {!isMe && (
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    onClick={() => setConfirmOrgRevoke(a)}
                                    disabled={actionLoading}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 text-xs font-semibold hover:bg-amber-100 transition-colors disabled:opacity-50"
                                  >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <path d="M18.36 6.64A9 9 0 0 1 20.77 15M6.16 6.16a9 9 0 1 0 12.68 12.68M2 2l20 20"/>
                                    </svg>
                                    Revoke
                                  </button>
                                  {/* Only show delete for non-admin staff (admin deletions are more complex) */}
                                  {a.orgRole === 'staff' && a.staffMemberId && (
                                    <button
                                      onClick={() => {
                                        const sm = staff.find(s => s.id === a.staffMemberId);
                                        if (sm) setConfirmAction({ type: 'delete', staff: sm });
                                      }}
                                      className="p-1.5 rounded-lg hover:bg-danger-light text-text-tertiary hover:text-danger transition-colors"
                                      title="Remove from roster"
                                    >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <polyline points="3 6 5 6 21 6"/>
                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                      </svg>
                                    </button>
                                  )}
                                </div>
                              )}
                            </motion.div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Pending invites */}
                  {pendingAccounts.length > 0 && (
                    <div>
                      <h2 className="text-xs font-bold text-text-tertiary uppercase tracking-widest mb-3">
                        Invite pending — {pendingAccounts.length}
                      </h2>
                      <div className="space-y-2">
                        {pendingAccounts.map((a, i) => {
                          const sm = a.staffMemberId ? staff.find(s => s.id === a.staffMemberId) : undefined;
                          return (
                            <motion.div
                              key={a.membershipId}
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: i * 0.04 }}
                              className="card p-4 flex items-center gap-3"
                            >
                              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-sm font-bold text-amber-700 shrink-0">
                                {a.fullName.charAt(0).toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm font-bold text-text-primary">{a.fullName}</p>
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full border border-amber-200">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block animate-pulse" />
                                    Invite pending
                                  </span>
                                </div>
                                <p className="text-xs text-text-tertiary mt-0.5 truncate">
                                  {a.staffRole ? <span className="capitalize">{a.staffRole}</span> : 'Staff'}
                                  {a.email && ` · ${a.email}`}
                                </p>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {sm && (
                                  <button
                                    onClick={() => handleInvite(sm)}
                                    disabled={inviting === sm.id}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary-border bg-primary-light text-primary text-xs font-semibold hover:bg-primary hover:text-white transition-all disabled:opacity-50"
                                  >
                                    {inviting === sm.id ? (
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                                        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                                      </svg>
                                    ) : (
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                                      </svg>
                                    )}
                                    Resend
                                  </button>
                                )}
                                <button
                                  onClick={() => setConfirmOrgRevoke(a)}
                                  className="p-1.5 rounded-lg hover:bg-amber-50 text-text-tertiary hover:text-amber-600 transition-colors"
                                  title="Cancel invite"
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                                  </svg>
                                </button>
                              </div>
                            </motion.div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* No account — staff in roster with no org_members row */}
                  {noAccount.length > 0 && (
                    <div>
                      <h2 className="text-xs font-bold text-text-tertiary uppercase tracking-widest mb-3">
                        No account — {noAccount.length}
                      </h2>
                      <div className="space-y-2">
                        {noAccount.map((s, i) => (
                          <motion.div
                            key={s.id}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.04 }}
                            className="card p-4 flex items-center gap-3 opacity-70"
                          >
                            <div className="w-10 h-10 rounded-full bg-surface-elevated flex items-center justify-center text-sm font-bold text-text-tertiary shrink-0">
                              {s.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-bold text-text-primary">{s.name}</p>
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-surface-elevated text-text-tertiary px-2 py-0.5 rounded-full border border-border-light">No account</span>
                              </div>
                              <p className="text-xs text-text-tertiary mt-0.5 truncate">
                                <span className="capitalize">{s.role}</span>
                                {s.email ? ` · ${s.email}` : ' · No email on file'}
                              </p>
                            </div>
                            <button
                              onClick={() => handleInvite(s)}
                              disabled={inviting === s.id}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary-border bg-primary-light text-primary text-xs font-semibold hover:bg-primary hover:text-white transition-all disabled:opacity-50 shrink-0"
                            >
                              {inviting === s.id ? (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                                  <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                                </svg>
                              ) : (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                                  <polyline points="22,6 12,13 2,6"/>
                                </svg>
                              )}
                              Send invite
                            </button>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  )}

                  {activeAccounts.length === 0 && pendingAccounts.length === 0 && noAccount.length === 0 && (
                    <div className="text-center py-16">
                      <p className="text-sm text-text-tertiary">No staff members yet. Add some from the Roster tab.</p>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      {/* ── Confirm modal (staff_members-based actions) ─────────────────── */}
      <AnimatePresence>
        {confirmAction && (
          <ConfirmModal
            action={confirmAction}
            onConfirm={handleConfirm}
            onCancel={() => setConfirmAction(null)}
            loading={actionLoading}
          />
        )}
      </AnimatePresence>

      {/* ── Confirm revoke org account (org_members-based) ──────────────── */}
      <AnimatePresence>
        {confirmOrgRevoke && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={() => setConfirmOrgRevoke(null)}
          >
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              onClick={e => e.stopPropagation()}
              className="relative bg-white rounded-2xl w-full max-w-[420px] p-6 shadow-2xl"
            >
              <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center mb-4">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2">
                  <path d="M18.36 6.64A9 9 0 0 1 20.77 15M6.16 6.16a9 9 0 1 0 12.68 12.68M2 2l20 20"/>
                </svg>
              </div>
              <h3 className="text-lg font-bold text-text-primary mb-1">Revoke access?</h3>
              <p className="text-sm text-text-secondary mb-5 leading-relaxed">
                <span className="font-semibold text-text-primary">{confirmOrgRevoke.fullName}</span> will immediately
                lose access to CleanRoute Pro. Their account will be deleted if they have no other organisations.
                {confirmOrgRevoke.staffMemberId && ' Their staff roster record will remain.'}
              </p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmOrgRevoke(null)} disabled={actionLoading} className="flex-1 btn-secondary text-sm py-2.5">
                  Cancel
                </button>
                <button
                  onClick={() => handleRevokeOrgAccount(confirmOrgRevoke)}
                  disabled={actionLoading}
                  className="flex-1 bg-amber-500 text-white text-sm py-2.5 rounded-xl font-semibold hover:bg-amber-600 transition-all disabled:opacity-60"
                >
                  {actionLoading ? 'Revoking...' : 'Revoke access'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
