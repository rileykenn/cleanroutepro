'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import StaffPortalPage from '../staff-view/page';

export default function StaffPreviewPage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [staffList, setStaffList] = useState<{ id: string; name: string }[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const [selectedStaffName, setSelectedStaffName] = useState<string>('');

  // Redirect non-admin users
  useEffect(() => {
    if (!authLoading && profile?.role === 'staff') {
      router.replace('/dashboard/staff-view');
    }
  }, [profile, authLoading, router]);

  // Load staff list
  useEffect(() => {
    if (!profile?.org_id) return;
    (async () => {
      const { data } = await supabase
        .from('staff_members')
        .select('id, name')
        .eq('org_id', profile.org_id)
        .eq('archived', false)
        .order('name');
      if (data) setStaffList(data);
    })();
  }, [profile?.org_id, supabase]);

  const handleSelectStaff = (staffId: string) => {
    setSelectedStaffId(staffId);
    const staff = staffList.find(s => s.id === staffId);
    setSelectedStaffName(staff?.name || '');
  };

  if (authLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="shimmer h-10 w-48 rounded-xl" />
      </div>
    );
  }

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
            onChange={(e) => handleSelectStaff(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-border-light bg-surface-elevated text-sm font-medium text-text-primary appearance-none cursor-pointer hover:border-primary/40 focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none transition-all min-w-[180px]"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%236B7280' stroke-width='2.5' xmlns='http://www.w3.org/2000/svg'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 10px center',
              paddingRight: '28px',
            }}
          >
            <option value="">Select staff member…</option>
            {staffList.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>

          {/* Preview badge */}
          {selectedStaffId && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 shrink-0"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" className="shrink-0">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              <span className="text-[11px] text-amber-800 font-medium whitespace-nowrap">
                Viewing as <span className="font-bold">{selectedStaffName}</span>
              </span>
            </motion.div>
          )}
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait">
          {selectedStaffId ? (
            <motion.div
              key={selectedStaffId}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="h-full"
            >
              <StaffPortalPage overrideStaffId={selectedStaffId} overrideStaffName={selectedStaffName} />
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
                Choose from the dropdown above to preview their dashboard
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
