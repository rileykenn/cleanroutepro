'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { AuthProvider, useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import OrgSwitcher, { DeleteOrgModal } from '@/components/OrgSwitcher';
import CreateOrgModal from '@/components/CreateOrgModal';

interface UserProfile {
  id: string; org_id: string; full_name: string; email: string;
  role: 'admin' | 'staff'; is_platform_admin: boolean;
  onboarding_completed: boolean; org_name: string;
  subscription_status: string; subscription_tier: string;
  timezone: string | null;
}

interface OrgMembership { org_id: string; role: string; org_name: string; }

const ADMIN_NAV = [
  { label: 'Schedule', href: '/dashboard/schedule', d: 'M3 4h18v18H3zM16 2v4M8 2v4M3 10h18' },
  { label: 'Completed', href: '/dashboard/completed', d: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 0 2-2h2a2 2 0 0 0 2 2m-6 9l2 2 4-4' },
  { label: 'Clients', href: '/dashboard/checklists', d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 .01M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
  { label: 'Templates', href: '/dashboard/templates', d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8' },
  { label: 'Staff', href: '/dashboard/staff', d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 .01M19 8v6M22 11h-6' },
  { label: 'Settings', href: '/dashboard/settings', d: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' },
];

const STAFF_NAV = [
  { label: 'My Schedule', href: '/dashboard/staff-view', d: 'M3 4h18v18H3zM16 2v4M8 2v4M3 10h18' },
];

export default function DashboardShell({ children, serverProfile }: { children: React.ReactNode; serverProfile: UserProfile | null }) {
  return <AuthProvider serverProfile={serverProfile}><Inner>{children}</Inner></AuthProvider>;
}

function Inner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, signOut, refreshProfile } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [orgs, setOrgs] = useState<OrgMembership[]>([]);
  const [switching, setSwitching] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [showDelete, setShowDelete] = useState<{ orgId: string; orgName: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showInvites, setShowInvites] = useState(false);
  const [pendingInvites, setPendingInvites] = useState<{ id: string; org_name: string; role: string }[]>([]);
  const [showCreateOrg, setShowCreateOrg] = useState(false);

  const hasOrg = !!profile?.org_id;
  const userRole = profile?.role || 'staff';
  const navItems = userRole === 'staff' ? STAFF_NAV : ADMIN_NAV;

  const loadOrgs = useCallback(async () => {
    if (!profile?.id) return;

    // Load accepted orgs (RLS works for these since user has org_id)
    const { data } = await supabase.from('org_members')
      .select('org_id, role, status, organizations:org_id(name)')
      .eq('user_id', profile.id)
      .eq('status', 'accepted');

    if (data) {
      const accepted = (data as Record<string, unknown>[]).map(m => {
        const org = m.organizations as Record<string, unknown> | null;
        return {
          org_id: m.org_id as string,
          role: m.role as string,
          org_name: (org?.name as string) || 'Unknown',
        };
      });
      setOrgs(accepted);
    }

    // Load pending invites via server API (bypasses RLS for org name lookup)
    try {
      const res = await fetch('/api/invite/pending');
      if (res.ok) {
        const { invites } = await res.json();
        setPendingInvites(invites || []);
        setPendingCount((invites || []).length);
      }
    } catch { /* silent */ }
  }, [supabase, profile?.id]);

  useEffect(() => { loadOrgs(); }, [loadOrgs]);

  const handleSwitch = async (orgId: string) => {
    if (orgId === profile?.org_id || switching) return;
    setSwitching(true);
    const res = await fetch('/api/org/switch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId }),
    });
    if (res.ok) {
      const d = await res.json();
      await refreshProfile();
      router.push(d.role === 'staff' ? '/dashboard/staff-view' : '/dashboard/schedule');
      router.refresh();
    }
    setSwitching(false);
  };

  const handleCreate = () => { setShowCreateOrg(true); };

  const handleDelete = async () => {
    if (!showDelete || deleting) return;
    setDeleting(true);
    const res = await fetch('/api/org/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId: showDelete.orgId, confirmText: 'delete my organisation' }),
    });
    if (res.ok) {
      setShowDelete(null);
      await refreshProfile();
      router.push('/dashboard');
      router.refresh();
    }
    setDeleting(false);
  };

  const handleRespondInvite = async (inviteId: string, action: 'accept' | 'decline') => {
    // Immediately remove from UI
    setPendingInvites(p => p.filter(i => i.id !== inviteId));
    setPendingCount(c => Math.max(0, c - 1));
    setShowInvites(false);

    const res = await fetch('/api/invite/respond', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ membershipId: inviteId, action }),
    });
    if (res.ok && action === 'accept') {
      await refreshProfile();
      await loadOrgs();
      router.push('/dashboard');
      router.refresh();
    }
  };

  // No org = render children directly (they show the no-org state)
  if (!hasOrg) {
    return (
      <div className="h-full flex flex-col">
        <div className="shrink-0 h-14 border-b border-border-light flex items-center justify-between px-4 bg-white">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/><circle cx="12" cy="10" r="3"/>
              </svg>
            </div>
            <span className="text-sm font-bold text-text-primary">CleanRoute Pro</span>
          </div>
          <div className="flex items-center gap-2">
            {pendingCount > 0 && (
              <button onClick={() => setShowInvites(!showInvites)} className="relative p-2 rounded-lg hover:bg-surface-hover">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                </svg>
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-danger text-white text-[10px] font-bold rounded-full flex items-center justify-center">{pendingCount}</span>
              </button>
            )}
            <button onClick={async () => { await signOut(); window.location.href = '/login'; }}
              className="text-sm text-text-tertiary hover:text-danger transition-colors px-2 py-1">Sign out</button>
          </div>
        </div>
        <div className="flex-1 min-h-0">{children}</div>

        {/* Invite popup for no-org state */}
        <AnimatePresence>
          {showInvites && pendingInvites.length > 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/40" onClick={() => setShowInvites(false)} />
              <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="relative bg-white rounded-2xl w-full max-w-[420px] p-6 space-y-4">
                <h3 className="text-lg font-bold text-text-primary">Pending Invitations</h3>
                {pendingInvites.map(inv => (
                  <div key={inv.id} className="bg-surface-elevated rounded-xl p-4">
                    <p className="text-sm text-text-secondary">You've been invited to join <span className="font-semibold text-text-primary">{inv.org_name}</span></p>
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => handleRespondInvite(inv.id, 'accept')} className="btn-primary text-sm px-4">Accept</button>
                      <button onClick={() => handleRespondInvite(inv.id, 'decline')} className="btn-ghost text-sm text-text-tertiary hover:text-danger">Decline</button>
                    </div>
                  </div>
                ))}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="h-full flex">
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
        )}
      </AnimatePresence>

      <aside className={`fixed lg:static inset-y-0 left-0 z-50 w-[260px] bg-white border-r border-border-light flex flex-col transform transition-transform duration-300 ease-in-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        {/* Org Switcher Header */}
        <div className="p-4 border-b border-border-light">
          <OrgSwitcher orgs={orgs} activeOrgId={profile?.org_id || ''} activeOrgName={profile?.org_name || ''}
            onSwitch={handleSwitch} onCreate={handleCreate} switching={switching}
            onDelete={(orgId, orgName) => setShowDelete({ orgId, orgName })} />
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <a key={item.href} href={item.href} onClick={(e) => { e.preventDefault(); router.push(item.href); setSidebarOpen(false); }}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${isActive ? 'bg-primary-light text-primary border border-primary-border' : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary border border-transparent'}`}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={isActive ? 'text-primary' : 'text-text-tertiary'}>
                  <path d={item.d}/>
                </svg>
                {item.label}
              </a>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="p-4 border-t border-border-light">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-primary-light flex items-center justify-center text-sm font-bold text-primary shrink-0">
              {(profile?.full_name || profile?.email || '?').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text-primary truncate">{profile?.full_name || profile?.email}</p>
              <p className="text-xs text-text-tertiary capitalize">{userRole}</p>
            </div>
            {/* Notification bell */}
            {pendingCount > 0 && (
              <button onClick={() => setShowInvites(true)} className="relative p-1.5 rounded-lg hover:bg-surface-hover">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                </svg>
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-danger text-white text-[9px] font-bold rounded-full flex items-center justify-center">{pendingCount}</span>
              </button>
            )}
          </div>
          {/* Delete org (admin only) */}
          {userRole === 'admin' && (
            <button onClick={() => setShowDelete({ orgId: profile?.org_id || '', orgName: profile?.org_name || '' })}
              className="w-full text-left px-3 py-2 rounded-lg text-xs text-text-tertiary hover:bg-surface-hover hover:text-danger transition-colors mb-1">
              Delete Organisation
            </button>
          )}
          <button onClick={async () => { await signOut(); window.location.href = '/login'; }}
            className="w-full text-left px-3 py-2 rounded-lg text-sm text-text-secondary hover:bg-surface-hover hover:text-danger transition-colors flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {/* Mobile top header — org name (admin only; staff-view manages its own header) */}
        {userRole !== 'staff' && (
        <div className="lg:hidden shrink-0 h-12 border-b border-border-light flex items-center justify-between px-4 bg-white">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center shrink-0">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/><circle cx="12" cy="10" r="3"/>
              </svg>
            </div>
            <span className="text-sm font-bold text-text-primary truncate">{profile?.org_name}</span>
          </div>
          {pendingCount > 0 && (
            <button onClick={() => setShowInvites(true)} className="relative p-2 rounded-lg">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
              </svg>
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-danger text-white text-[10px] font-bold rounded-full flex items-center justify-center">{pendingCount}</span>
            </button>
          )}
        </div>
        )}


        {/* Page content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {children}
        </div>

        {/* ── Mobile bottom tab bar (admin nav only) ── */}
        {userRole !== 'staff' && (
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-border-light pb-safe" style={{ boxShadow: '0 -1px 0 0 #F3F4F6, 0 -4px 16px rgba(0,0,0,0.06)' }}>
          <div className="flex items-stretch h-14">
            {navItems.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <button
                  key={item.href}
                  onClick={() => router.push(item.href)}
                  className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                    isActive ? 'text-primary' : 'text-text-tertiary'
                  }`}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={isActive ? 2.5 : 1.8} className="shrink-0">
                    <path d={item.d}/>
                  </svg>
                  <span className={`text-[10px] font-semibold leading-none ${isActive ? 'text-primary' : 'text-text-tertiary'}`}>
                    {item.label === 'My Schedule' ? 'Schedule' : item.label}
                  </span>
                  {isActive && (
                    <span className="absolute bottom-0 w-6 h-0.5 bg-primary rounded-full" />
                  )}
                </button>
              );
            })}
          </div>
        </nav>
        )}
      </div>


      {/* Invite modal */}
      <AnimatePresence>
        {showInvites && pendingInvites.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40" onClick={() => setShowInvites(false)} />
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="relative bg-white rounded-2xl w-full max-w-[420px] p-6 space-y-4">
              <h3 className="text-lg font-bold text-text-primary">Pending Invitations</h3>
              {pendingInvites.map(inv => (
                <div key={inv.id} className="bg-surface-elevated rounded-xl p-4">
                  <p className="text-sm text-text-secondary">Invited to join <span className="font-semibold text-text-primary">{inv.org_name}</span></p>
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => handleRespondInvite(inv.id, 'accept')} className="btn-primary text-sm px-4">Accept</button>
                    <button onClick={() => handleRespondInvite(inv.id, 'decline')} className="btn-ghost text-sm text-text-tertiary hover:text-danger">Decline</button>
                  </div>
                </div>
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete modal */}
      {showDelete && (
        <DeleteOrgModal orgName={showDelete.orgName} onConfirm={handleDelete} onCancel={() => setShowDelete(null)} deleting={deleting} />
      )}

      {/* Create org modal */}
      {showCreateOrg && (
        <CreateOrgModal
          onCancel={() => setShowCreateOrg(false)}
          onCreated={async () => {
            setShowCreateOrg(false);
            await refreshProfile();
            await loadOrgs();
            router.push('/dashboard/schedule');
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
