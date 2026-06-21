'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { AuthProvider, useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import OrgSwitcher, { DeleteOrgModal } from '@/components/OrgSwitcher';
import CreateOrgModal from '@/components/CreateOrgModal';

import { ROLE_LABELS, type Role } from '@/lib/permissions';

interface UserProfile {
  id: string; org_id: string; full_name: string; email: string;
  role: Role; is_platform_admin: boolean;
  onboarding_completed: boolean; org_name: string;
  subscription_status: string; subscription_tier: string;
  timezone: string | null;
}

interface OrgMembership { org_id: string; role: string; org_name: string; }

// ── Nav item definitions ────────────────────────────────────────────────────
interface NavItem { label: string; href: string; icon: string; }

const NAV_ICONS = {
  schedule:    'M8 2v4M16 2v4M3 10h18M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z',
  completed:   'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 0 2-2h2a2 2 0 0 0 2 2m-6 9l2 2 4-4',
  clients:     'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 .01M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  templates:   'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8',
  staff:       'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 .01M19 8v6M22 11h-6',
  staffView:   'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  settings:    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  mySchedule:  'M8 2v4M16 2v4M3 10h18M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z',
};

/** Build nav items based on role — desktop only. Mobile always shows staff view. */
function getNavForRole(role: Role): NavItem[] {
  switch (role) {
    case 'owner':
      return [
        { label: 'Schedule',   href: '/dashboard/schedule',      icon: NAV_ICONS.schedule },
        { label: 'Completed',  href: '/dashboard/completed',      icon: NAV_ICONS.completed },
        { label: 'Clients',    href: '/dashboard/checklists',     icon: NAV_ICONS.clients },
        { label: 'Templates',  href: '/dashboard/templates',      icon: NAV_ICONS.templates },
        { label: 'Staff',      href: '/dashboard/staff',          icon: NAV_ICONS.staff },
        { label: 'Staff View', href: '/dashboard/staff-preview',  icon: NAV_ICONS.staffView },
        { label: 'Settings',   href: '/dashboard/settings',       icon: NAV_ICONS.settings },
      ];
    case 'admin':
      return [
        { label: 'Schedule',   href: '/dashboard/schedule',      icon: NAV_ICONS.schedule },
        { label: 'Completed',  href: '/dashboard/completed',      icon: NAV_ICONS.completed },
        { label: 'Clients',    href: '/dashboard/checklists',     icon: NAV_ICONS.clients },
        { label: 'Templates',  href: '/dashboard/templates',      icon: NAV_ICONS.templates },
        { label: 'Staff',      href: '/dashboard/staff',          icon: NAV_ICONS.staff },
        { label: 'Staff View', href: '/dashboard/staff-preview',  icon: NAV_ICONS.staffView },
        { label: 'Settings',   href: '/dashboard/settings',       icon: NAV_ICONS.settings },
      ];
    case 'supervisor':
      return [
        { label: 'My Schedule',          href: '/dashboard/staff-view', icon: NAV_ICONS.mySchedule },
        { label: 'Published Schedules',  href: '/dashboard/completed',  icon: NAV_ICONS.completed },
      ];
    case 'staff':
    default:
      return [
        { label: 'My Schedule', href: '/dashboard/staff-view', icon: NAV_ICONS.mySchedule },
      ];
  }
}

const MOBILE_STAFF_NAV: NavItem[] = [
  { label: 'My Schedule', href: '/dashboard/staff-view', icon: NAV_ICONS.mySchedule },
];

export default function DashboardShell({ children, serverProfile }: { children: React.ReactNode; serverProfile: UserProfile | null }) {
  return <AuthProvider serverProfile={serverProfile}><Inner>{children}</Inner></AuthProvider>;
}

function Inner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, signOut, refreshProfile } = useAuth();
  const supabase = useMemo(() => createClient(), []);

  const [orgs, setOrgs] = useState<OrgMembership[]>([]);
  const [switching, setSwitching] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [showDelete, setShowDelete] = useState<{ orgId: string; orgName: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showInvites, setShowInvites] = useState(false);
  const [pendingInvites, setPendingInvites] = useState<{ id: string; org_name: string; role: string }[]>([]);
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const orgMenuRef = useRef<HTMLDivElement>(null);

  const hasOrg = !!profile?.org_id;
  const userRole: Role = (profile?.role as Role) || 'staff';
  const initials = (profile?.full_name || profile?.email || '?').charAt(0).toUpperCase();

  // ── Mobile detection: all roles see staff view on mobile ────────────────
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024); // lg breakpoint
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Auto-redirect to staff-view on mobile (except staff who are already there)
  useEffect(() => {
    if (isMobile && hasOrg && !pathname.startsWith('/dashboard/staff-view') && pathname !== '/dashboard') {
      router.replace('/dashboard/staff-view');
    }
  }, [isMobile, hasOrg, pathname, router]);

  // Desktop: role-based nav — Mobile: always staff nav
  const navItems = useMemo(() => {
    if (isMobile) return MOBILE_STAFF_NAV;
    return getNavForRole(userRole);
  }, [userRole, isMobile]);

  // Close menus on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false);
      if (orgMenuRef.current && !orgMenuRef.current.contains(e.target as Node)) setOrgMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const loadOrgs = useCallback(async () => {
    if (!profile?.id) return;
    const { data } = await supabase.from('org_members')
      .select('org_id, role, status, organizations:org_id(name)')
      .eq('user_id', profile.id)
      .eq('status', 'accepted');

    if (data) {
      const accepted = (data as Record<string, unknown>[]).map(m => {
        const org = m.organizations as Record<string, unknown> | null;
        return { org_id: m.org_id as string, role: m.role as string, org_name: (org?.name as string) || 'Unknown' };
      });
      setOrgs(accepted);
    }

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
    setOrgMenuOpen(false);
  };

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

  // ── No-org state ──────────────────────────────────────────────────────────
  if (!hasOrg) {
    return (
      <div className="h-full flex flex-col">
        <header className="shrink-0 h-14 glass-navbar flex items-center justify-between px-5">
          <Logo />
          <div className="flex items-center gap-2">
            {pendingCount > 0 && (
              <button onClick={() => setShowInvites(!showInvites)} className="relative p-2 rounded-xl hover:bg-surface-hover transition-colors">
                <BellIcon />
                <Badge count={pendingCount} />
              </button>
            )}
            <button onClick={async () => { await signOut(); window.location.href = '/login'; }}
              className="text-sm text-text-tertiary hover:text-danger transition-colors px-3 py-1.5 rounded-lg hover:bg-surface-hover">
              Sign out
            </button>
          </div>
        </header>
        <div className="flex-1 min-h-0">{children}</div>
        <InviteModal show={showInvites} invites={pendingInvites} onClose={() => setShowInvites(false)} onRespond={handleRespondInvite} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* ── Top Navigation Bar ───────────────────────────────────────────── */}
      <header className="shrink-0 z-40 glass-navbar" style={{ height: '56px' }}>
        <div className="h-full flex items-center gap-1 px-4">

          {/* Logo + Org name */}
          <div className="flex items-center gap-3 mr-4 min-w-0">
            <Logo />
            {/* Org switcher button */}
            {orgs.length > 1 ? (
              <div className="relative" ref={orgMenuRef}>
                <button
                  onClick={() => setOrgMenuOpen(v => !v)}
                  className="flex items-center gap-1.5 text-sm font-semibold text-text-primary hover:text-primary transition-colors max-w-[160px] truncate"
                >
                  <span className="truncate">{profile?.org_name}</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                    className={`shrink-0 transition-transform ${orgMenuOpen ? 'rotate-180' : ''}`}>
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>
                <AnimatePresence>
                  {orgMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -6, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.97 }}
                      transition={{ duration: 0.15 }}
                      className="absolute left-0 top-full mt-2 w-56 bg-white rounded-xl border border-border-light shadow-[0_8px_32px_rgba(0,0,0,0.12)] py-1.5 z-50"
                    >
                      <p className="px-3 py-1 text-[10px] font-bold text-text-tertiary uppercase tracking-wider">Your Organisations</p>
                      {orgs.map(org => (
                        <button key={org.org_id} onClick={() => handleSwitch(org.org_id)}
                          className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2 ${org.org_id === profile?.org_id ? 'text-primary font-semibold bg-primary-light' : 'text-text-primary hover:bg-surface-hover'}`}>
                          {org.org_id === profile?.org_id && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0"/>}
                          <span className="truncate">{org.org_name}</span>
                        </button>
                      ))}
                      <hr className="my-1 border-border-light"/>
                      <button onClick={() => { setShowCreateOrg(true); setOrgMenuOpen(false); }}
                        className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-surface-hover transition-colors flex items-center gap-2">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
                        New Organisation
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <span className="text-sm font-semibold text-text-primary max-w-[160px] truncate hidden sm:block">{profile?.org_name}</span>
            )}
          </div>

          {/* Nav links — desktop */}
          <nav className="hidden lg:flex items-center gap-0.5 flex-1">
            {navItems.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <button key={item.href}
                  onClick={() => router.push(item.href)}
                  className={`relative flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-primary-light text-primary'
                      : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                  }`}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={isActive ? 2.5 : 2}>
                    <path d={item.icon}/>
                  </svg>
                  {item.label}
                  {isActive && (
                    <motion.span layoutId="nav-pill"
                      className="absolute inset-0 rounded-xl bg-primary-light -z-10"
                      transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
                    />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Right side — bell + user */}
          <div className="ml-auto flex items-center gap-1.5">
            {pendingCount > 0 && (
              <button onClick={() => setShowInvites(true)}
                className="relative p-2 rounded-xl hover:bg-surface-hover transition-colors">
                <BellIcon />
                <Badge count={pendingCount} />
              </button>
            )}

            {/* User avatar dropdown */}
            <div className="relative" ref={userMenuRef}>
              <button
                onClick={() => setUserMenuOpen(v => !v)}
                className="flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-xl hover:bg-surface-hover transition-colors"
              >
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary to-primary-hover flex items-center justify-center text-xs font-bold text-white shrink-0">
                  {initials}
                </div>
                <span className="text-sm font-medium text-text-primary hidden sm:block max-w-[120px] truncate">
                  {profile?.full_name || profile?.email}
                </span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                  className={`text-text-tertiary transition-transform ${userMenuOpen ? 'rotate-180' : ''}`}>
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>

              <AnimatePresence>
                {userMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.97 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl border border-border-light shadow-[0_8px_32px_rgba(0,0,0,0.12)] py-1.5 z-50"
                  >
                    {/* User info */}
                    <div className="px-3 py-2 border-b border-border-light mb-1">
                      <p className="text-sm font-semibold text-text-primary truncate">{profile?.full_name || profile?.email}</p>
                      <p className="text-xs text-text-tertiary capitalize">{ROLE_LABELS[userRole] || userRole} · {profile?.org_name}</p>
                    </div>

                    {(userRole === 'owner' || userRole === 'admin') && (
                      <button
                        onClick={() => { router.push('/dashboard/settings'); setUserMenuOpen(false); }}
                        className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-surface-hover transition-colors flex items-center gap-2"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                        Settings
                      </button>
                    )}

                    {userRole === 'owner' && (
                      <button
                        onClick={() => { setShowDelete({ orgId: profile?.org_id || '', orgName: profile?.org_name || '' }); setUserMenuOpen(false); }}
                        className="w-full text-left px-3 py-2 text-sm text-danger hover:bg-danger-light transition-colors flex items-center gap-2"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        Delete Organisation
                      </button>
                    )}

                    <hr className="my-1 border-border-light"/>
                    <button
                      onClick={async () => { await signOut(); window.location.href = '/login'; }}
                      className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-danger-light hover:text-danger transition-colors flex items-center gap-2"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                      Sign out
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </header>

      {/* ── Page content ─────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {children}
      </div>

      {/* ── Mobile bottom tab bar ─────────────────────────────────────────── */}
      {!isMobile && userRole !== 'staff' && (
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-lg border-t border-border-light pb-safe"
          style={{ boxShadow: '0 -1px 0 0 rgba(0,0,0,0.06), 0 -8px 24px rgba(0,0,0,0.06)' }}>
          <div className="flex items-stretch h-14">
            {navItems.filter(item => item.href !== '/dashboard/staff-preview').map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <button
                  key={item.href}
                  onClick={() => router.push(item.href)}
                  className={`flex-1 flex flex-col items-center justify-center gap-1 transition-colors relative ${
                    isActive ? 'text-primary' : 'text-text-tertiary'
                  }`}
                >
                  {isActive && (
                    <motion.span
                      layoutId="mobile-nav-pill"
                      className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary rounded-full"
                    />
                  )}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={isActive ? 2.5 : 1.8} className="shrink-0">
                    <path d={item.icon}/>
                  </svg>
                  <span className={`text-[10px] font-semibold leading-none ${isActive ? 'text-primary' : 'text-text-tertiary'}`}>
                    {item.label === 'My Schedule' ? 'Schedule' : item.label}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      )}

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      <InviteModal show={showInvites} invites={pendingInvites} onClose={() => setShowInvites(false)} onRespond={handleRespondInvite} />

      {showDelete && (
        <DeleteOrgModal orgName={showDelete.orgName} onConfirm={handleDelete} onCancel={() => setShowDelete(null)} deleting={deleting} />
      )}

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

// ── Shared sub-components ───────────────────────────────────────────────────

function Logo() {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-primary-hover flex items-center justify-center shadow-sm">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
          <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/>
          <circle cx="12" cy="10" r="3"/>
        </svg>
      </div>
      <span className="text-sm font-bold text-text-primary hidden sm:block">CleanRoute</span>
    </div>
  );
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
  );
}

function Badge({ count }: { count: number }) {
  return (
    <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-danger text-white text-[9px] font-bold rounded-full flex items-center justify-center px-1">
      {count}
    </span>
  );
}

function InviteModal({ show, invites, onClose, onRespond }: {
  show: boolean;
  invites: { id: string; org_name: string; role: string }[];
  onClose: () => void;
  onRespond: (id: string, action: 'accept' | 'decline') => void;
}) {
  return (
    <AnimatePresence>
      {show && invites.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={onClose} />
          <motion.div initial={{ scale: 0.95, y: 8 }} animate={{ scale: 1, y: 0 }}
            className="relative bg-white rounded-2xl w-full max-w-[420px] p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
              </div>
              <h3 className="text-lg font-bold text-text-primary">Pending Invitations</h3>
            </div>
            {invites.map(inv => (
              <div key={inv.id} className="bg-surface-elevated rounded-xl p-4">
                <p className="text-sm text-text-secondary">You&apos;ve been invited to join <span className="font-semibold text-text-primary">{inv.org_name}</span></p>
                <div className="flex gap-2 mt-3">
                  <button onClick={() => onRespond(inv.id, 'accept')} className="btn-primary text-sm px-4">Accept</button>
                  <button onClick={() => onRespond(inv.id, 'decline')} className="btn-ghost text-sm text-text-tertiary hover:text-danger">Decline</button>
                </div>
              </div>
            ))}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
