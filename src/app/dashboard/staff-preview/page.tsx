'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import StaffPortalPage from '../staff-view/page';
import SchedulePage from '../schedule/page';

interface PreviewAccount {
  staffId: string;
  userId: string | null;
  name: string;
  role: 'admin' | 'supervisor' | 'staff';
}

const ROLE_LABELS: Record<string, { label: string; color: string; bg: string; border: string }> = {
  admin:      { label: 'Admin',      color: 'text-indigo-700',  bg: 'bg-indigo-50',  border: 'border-indigo-200' },
  supervisor: { label: 'Supervisor', color: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-200' },
  staff:      { label: 'Staff',      color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
};

const SUPERVISOR_NAV = ['Schedule', 'Completed', 'Clients', 'Staff View'];
const STAFF_NAV = ['My Schedule'];
const ADMIN_NAV = ['Schedule', 'Completed', 'Clients', 'Templates', 'Staff', 'Staff View', 'Settings'];

export default function StaffPreviewPage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [accounts, setAccounts] = useState<PreviewAccount[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const [selectedAccount, setSelectedAccount] = useState<PreviewAccount | null>(null);

  // Redirect staff users
  useEffect(() => {
    if (!authLoading && profile?.role === 'staff') {
      router.replace('/dashboard/staff-view');
    }
  }, [profile, authLoading, router]);

  // Load staff members with their auth roles
  useEffect(() => {
    if (!profile?.org_id) return;
    (async () => {
      // Get all staff members
      const { data: staffMembers } = await supabase
        .from('staff_members')
        .select('id, name, user_id')
        .eq('org_id', profile.org_id)
        .eq('archived', false)
        .order('name');

      if (!staffMembers) return;

      // Get org_members to map user_id -> role
      const userIds = staffMembers.map((s: { user_id: string | null }) => s.user_id).filter(Boolean) as string[];
      const roleMap = new Map<string, string>();

      if (userIds.length > 0) {
        const { data: members } = await supabase
          .from('org_members')
          .select('user_id, role')
          .eq('org_id', profile.org_id)
          .in('user_id', userIds);

        if (members) {
          for (const m of members) {
            roleMap.set(m.user_id, m.role);
          }
        }
      }

      const result: PreviewAccount[] = staffMembers.map((s: { id: string; user_id: string | null; name: string }) => ({
        staffId: s.id,
        userId: s.user_id,
        name: s.name,
        role: (s.user_id ? roleMap.get(s.user_id) || 'staff' : 'staff') as 'admin' | 'supervisor' | 'staff',
      }));

      setAccounts(result);
    })();
  }, [profile?.org_id, supabase]);

  const handleSelect = (staffId: string) => {
    setSelectedStaffId(staffId);
    const account = accounts.find(a => a.staffId === staffId) || null;
    setSelectedAccount(account);
  };

  if (authLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="shimmer h-10 w-48 rounded-xl" />
      </div>
    );
  }

  const navItems = selectedAccount?.role === 'supervisor' ? SUPERVISOR_NAV
    : selectedAccount?.role === 'admin' ? ADMIN_NAV
    : STAFF_NAV;

  const roleStyle = selectedAccount ? ROLE_LABELS[selectedAccount.role] : null;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── Slim toolbar ──────────────────────────────────────────────── */}
      <div className="shrink-0 bg-white border-b border-border-light">
        <div className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
          {/* Label */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-7 h-7 rounded-lg bg-primary-light flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2.5">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </div>
            <span className="text-sm font-bold text-text-primary hidden sm:block">Staff View</span>
          </div>

          {/* Divider */}
          <div className="w-px h-5 bg-border-light shrink-0" />

          {/* Staff selector */}
          <select
            value={selectedStaffId}
            onChange={(e) => handleSelect(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-border-light bg-surface-elevated text-sm font-medium text-text-primary appearance-none cursor-pointer hover:border-primary/40 focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none transition-all min-w-[180px]"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%236B7280' stroke-width='2.5' xmlns='http://www.w3.org/2000/svg'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 10px center',
              paddingRight: '28px',
            }}
          >
            <option value="">Select staff member…</option>
            {accounts.map(a => {
              const r = ROLE_LABELS[a.role];
              return (
                <option key={a.staffId} value={a.staffId}>
                  {a.name} ({r.label})
                </option>
              );
            })}
          </select>

          {/* Preview badge with role */}
          {selectedAccount && roleStyle && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="hidden sm:flex items-center gap-2 shrink-0"
            >
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" className="shrink-0">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
                <span className="text-[11px] text-amber-800 font-medium whitespace-nowrap">
                  Viewing as <span className="font-bold">{selectedAccount.name}</span>
                </span>
              </div>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${roleStyle.bg} ${roleStyle.color} ${roleStyle.border}`}>
                {roleStyle.label}
              </span>
            </motion.div>
          )}

          {/* Nav preview */}
          {selectedAccount && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="hidden lg:flex items-center gap-1 ml-auto"
            >
              <span className="text-[10px] text-text-tertiary mr-1">Pages:</span>
              {navItems.map(item => (
                <span key={item} className="text-[10px] font-medium text-text-secondary bg-surface-elevated px-2 py-0.5 rounded-md border border-border-light">
                  {item}
                </span>
              ))}
            </motion.div>
          )}
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait">
          {selectedAccount ? (
            <motion.div
              key={`${selectedStaffId}-${selectedAccount.role}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="h-full overflow-auto"
            >
              {selectedAccount.role === 'staff' ? (
                <StaffPortalPage overrideStaffId={selectedStaffId} overrideStaffName={selectedAccount.name} />
              ) : (
                <SchedulePage overrideRole={selectedAccount.role} />
              )}
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full flex flex-col items-center justify-center px-6 text-center"
            >
              <div className="w-16 h-16 rounded-2xl bg-surface-elevated border border-border-light flex items-center justify-center mb-3">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-tertiary">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </div>
              <p className="text-base font-bold text-text-primary">Select a staff member</p>
              <p className="text-sm text-text-secondary mt-1 max-w-xs">
                Choose from the dropdown above to preview their dashboard experience based on their role
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
