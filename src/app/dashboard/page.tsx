'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { useRouter, useSearchParams } from 'next/navigation';
import { APIProvider } from '@vis.gl/react-google-maps';
import PlacesAutocomplete from '@/components/PlacesAutocomplete';
import { Location } from '@/lib/types';

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

interface PendingInvite {
  id: string;
  org_id: string;
  role: string;
  org_name: string;
}

export default function DashboardHomePage() {
  const { profile, refreshProfile } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [view, setView] = useState<'home' | 'create' | 'join'>('home');
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);

  // Org creation wizard state
  const [wizardStep, setWizardStep] = useState(0);
  const [businessName, setBusinessName] = useState('');
  const [staffList, setStaffList] = useState<{ name: string; email: string }[]>([]);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [clientList, setClientList] = useState<{ name: string; address: string; lat: number; lng: number; placeId: string }[]>([]);
  const [newClientName, setNewClientName] = useState('');
  const [newClientAddress, setNewClientAddress] = useState<Location | null>(null);
  const [creating, setCreating] = useState(false);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);

  // Load pending invites
  const loadInvites = useCallback(async () => {
    if (!profile?.id) { setLoading(false); return; }

    const { data: memberships } = await supabase
      .from('org_members')
      .select('id, org_id, role, status, organizations:org_id(name)')
      .eq('user_id', profile.id)
      .eq('status', 'pending');

    if (memberships) {
      const invites = memberships.map((m: Record<string, unknown>) => {
        const org = m.organizations as Record<string, unknown> | null;
        return {
          id: m.id as string,
          org_id: m.org_id as string,
          role: m.role as string,
          org_name: (org?.name as string) || 'Unknown',
        };
      });
      setPendingInvites(invites);
    }
    setLoading(false);
  }, [supabase, profile?.id]);

  useEffect(() => { loadInvites(); }, [loadInvites]);

  // If user already has an org, redirect
  useEffect(() => {
    if (!loading && profile?.org_id) {
      if (profile.role === 'staff') {
        router.push('/dashboard/staff-view');
      } else {
        router.push('/dashboard/schedule');
      }
    }
  }, [loading, profile?.org_id, profile?.role, router]);

  const handleRespondInvite = async (inviteId: string, action: 'accept' | 'decline') => {
    setRespondingTo(inviteId);
    const res = await fetch('/api/invite/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ membershipId: inviteId, action }),
    });
    if (res.ok) {
      if (action === 'accept') {
        await refreshProfile();
        router.push('/dashboard');
        router.refresh();
      } else {
        setPendingInvites(prev => prev.filter(i => i.id !== inviteId));
      }
    }
    setRespondingTo(null);
  };

  const addStaff = () => {
    if (!newStaffName.trim()) return;
    setStaffList([...staffList, { name: newStaffName.trim(), email: newStaffEmail.trim() }]);
    setNewStaffName('');
    setNewStaffEmail('');
  };

  const addClient = () => {
    if (!newClientName.trim() || !newClientAddress) return;
    setClientList([...clientList, {
      name: newClientName.trim(),
      address: newClientAddress.address,
      lat: newClientAddress.lat,
      lng: newClientAddress.lng,
      placeId: newClientAddress.placeId || '',
    }]);
    setNewClientName('');
    setNewClientAddress(null);
  };

  const handleCreateOrg = async () => {
    if (!businessName.trim() || creating) return;
    setCreating(true);
    const res = await fetch('/api/org/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: businessName, staff: staffList, clients: clientList }),
    });
    if (res.ok) {
      await refreshProfile();
      router.push('/dashboard/schedule');
      router.refresh();
    }
    setCreating(false);
  };

  if (loading) {
    return <div className="h-full flex items-center justify-center"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  }

  // If user has an org already, show nothing (redirect happening)
  if (profile?.org_id) return null;

  return (
    <APIProvider apiKey={MAPS_KEY} libraries={['places']}>
      <div className="h-full overflow-y-auto flex items-center justify-center p-4 lg:p-6">
        <AnimatePresence mode="wait">
          {/* ========== ORG CREATION WIZARD ========== */}
          {view === 'create' && (
            <motion.div key="create" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="w-full max-w-[520px]">
              <div className="card-elevated p-8">
                {/* Progress */}
                <div className="flex items-center gap-2 mb-6">
                  {['Business Name', 'Add Staff', 'Add Clients'].map((label, i) => (
                    <div key={i} className="flex-1">
                      <div className={`h-1.5 rounded-full transition-colors ${i <= wizardStep ? 'bg-primary' : 'bg-border'}`} />
                      <p className={`text-[10px] mt-1 ${i <= wizardStep ? 'text-primary font-medium' : 'text-text-tertiary'}`}>{label}</p>
                    </div>
                  ))}
                </div>

                <AnimatePresence mode="wait">
                  {/* Step 1: Business Name */}
                  {wizardStep === 0 && (
                    <motion.div key="step-0" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                      <div className="text-center mb-6">
                        <div className="text-4xl mb-3">🏢</div>
                        <h2 className="text-xl font-bold text-text-primary">What's your business name?</h2>
                        <p className="text-sm text-text-secondary mt-1">This will be your organisation name in CleanRoute Pro</p>
                      </div>
                      <input type="text" value={businessName} onChange={(e) => setBusinessName(e.target.value)}
                        className="input-field w-full text-sm" placeholder="e.g. The Cleaning Co" autoFocus />
                    </motion.div>
                  )}

                  {/* Step 2: Add Staff */}
                  {wizardStep === 1 && (
                    <motion.div key="step-1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                      <div className="text-center mb-6">
                        <div className="text-4xl mb-3">👥</div>
                        <h2 className="text-xl font-bold text-text-primary">Add your team members</h2>
                        <p className="text-sm text-text-secondary mt-1">You can always add more later</p>
                      </div>
                      <div className="space-y-3">
                        <div className="flex gap-2">
                          <input type="text" value={newStaffName} onChange={(e) => setNewStaffName(e.target.value)}
                            className="input-field flex-1 text-sm" placeholder="Name" onKeyDown={(e) => e.key === 'Enter' && addStaff()} />
                          <input type="email" value={newStaffEmail} onChange={(e) => setNewStaffEmail(e.target.value)}
                            className="input-field flex-1 text-sm" placeholder="Email (optional)" onKeyDown={(e) => e.key === 'Enter' && addStaff()} />
                          <button onClick={addStaff} className="btn-primary text-sm px-3 shrink-0">+</button>
                        </div>
                        {staffList.length > 0 && (
                          <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                            {staffList.map((s, i) => (
                              <div key={i} className="flex items-center justify-between bg-surface-elevated rounded-lg px-3 py-2">
                                <div>
                                  <span className="text-sm font-medium text-text-primary">{s.name}</span>
                                  {s.email && <span className="text-xs text-text-tertiary ml-2">{s.email}</span>}
                                </div>
                                <button onClick={() => setStaffList(staffList.filter((_, j) => j !== i))} className="text-text-tertiary hover:text-danger transition-colors">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}

                  {/* Step 3: Add Clients */}
                  {wizardStep === 2 && (
                    <motion.div key="step-2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                      <div className="text-center mb-6">
                        <div className="text-4xl mb-3">🏠</div>
                        <h2 className="text-xl font-bold text-text-primary">Add your clients</h2>
                        <p className="text-sm text-text-secondary mt-1">You can always add more later</p>
                      </div>
                      <div className="space-y-3">
                        <input type="text" value={newClientName} onChange={(e) => setNewClientName(e.target.value)}
                          className="input-field w-full text-sm" placeholder="Client name" />
                        <PlacesAutocomplete onPlaceSelect={setNewClientAddress} placeholder="Search for client address..." />
                        {newClientAddress && (
                          <p className="text-xs text-green-600 flex items-center gap-1">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                            {newClientAddress.address}
                          </p>
                        )}
                        <button onClick={addClient} disabled={!newClientName.trim() || !newClientAddress}
                          className="btn-primary text-sm w-full disabled:opacity-40">Add Client</button>
                        {clientList.length > 0 && (
                          <div className="space-y-1.5 max-h-[180px] overflow-y-auto">
                            {clientList.map((c, i) => (
                              <div key={i} className="flex items-center justify-between bg-surface-elevated rounded-lg px-3 py-2">
                                <div className="min-w-0">
                                  <span className="text-sm font-medium text-text-primary">{c.name}</span>
                                  <p className="text-xs text-text-tertiary truncate">{c.address}</p>
                                </div>
                                <button onClick={() => setClientList(clientList.filter((_, j) => j !== i))} className="text-text-tertiary hover:text-danger transition-colors shrink-0 ml-2">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Navigation */}
                <div className="flex items-center justify-between mt-8">
                  <button onClick={() => wizardStep === 0 ? setView('home') : setWizardStep(wizardStep - 1)}
                    className="btn-ghost text-sm">
                    {wizardStep === 0 ? 'Cancel' : 'Back'}
                  </button>
                  <div className="flex gap-2">
                    {wizardStep > 0 && wizardStep < 2 && (
                      <button onClick={() => setWizardStep(wizardStep + 1)} className="text-sm text-text-tertiary hover:text-text-secondary transition-colors px-3 py-2">
                        Do this later
                      </button>
                    )}
                    {wizardStep < 2 ? (
                      <button onClick={() => setWizardStep(wizardStep + 1)}
                        disabled={wizardStep === 0 && !businessName.trim()}
                        className="btn-primary text-sm px-6 disabled:opacity-40">Next</button>
                    ) : (
                      <div className="flex gap-2">
                        <button onClick={() => handleCreateOrg()} disabled={creating}
                          className="btn-primary text-sm px-6 disabled:opacity-60">
                          {creating ? 'Creating...' : 'Create Organisation'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ========== JOIN ORG INFO ========== */}
          {view === 'join' && (
            <motion.div key="join" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="w-full max-w-[440px]">
              <div className="card-elevated p-8 text-center">
                <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-5">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                    <line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
                  </svg>
                </div>
                <h2 className="text-xl font-bold text-text-primary mb-2">Join an Organisation</h2>
                <p className="text-sm text-text-secondary leading-relaxed mb-6">
                  To join an existing organisation, ask your manager or business owner to invite you using your email address:
                </p>
                <div className="bg-surface-elevated rounded-xl p-4 mb-6">
                  <p className="text-sm font-mono text-primary font-medium">{profile?.email}</p>
                </div>
                <p className="text-xs text-text-tertiary mb-6">Once they send you an invite, you'll see it here and in your email.</p>
                <button onClick={() => setView('home')} className="btn-ghost text-sm">← Back</button>
              </div>
            </motion.div>
          )}

          {/* ========== HOME (No Org State + Pending Invites) ========== */}
          {view === 'home' && (
            <motion.div key="home" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="w-full max-w-[520px]">
              {/* Pending Invites */}
              {pendingInvites.length > 0 && (
                <div className="mb-6 space-y-3">
                  {pendingInvites.map((invite) => (
                    <motion.div key={invite.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                      className="card-elevated p-6">
                      <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-xl bg-primary-light flex items-center justify-center shrink-0">
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2">
                            <rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-bold text-text-primary">You've been invited!</h3>
                          <p className="text-sm text-text-secondary mt-1">
                            You've been invited to join <span className="font-semibold text-text-primary">{invite.org_name}</span> as {invite.role === 'admin' ? 'an admin' : 'a team member'}.
                          </p>
                          <div className="flex gap-2 mt-4">
                            <button onClick={() => handleRespondInvite(invite.id, 'accept')}
                              disabled={respondingTo === invite.id}
                              className="btn-primary text-sm px-5 disabled:opacity-60">
                              {respondingTo === invite.id ? 'Accepting...' : 'Accept Invite'}
                            </button>
                            <button onClick={() => handleRespondInvite(invite.id, 'decline')}
                              disabled={respondingTo === invite.id}
                              className="btn-ghost text-sm text-text-tertiary hover:text-danger">
                              Decline
                            </button>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}

              {/* No Org State */}
              <div className="card-elevated p-8 text-center">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center mx-auto mb-6">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="1.5">
                    <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/>
                    <circle cx="12" cy="10" r="3"/>
                  </svg>
                </div>
                <h1 className="text-2xl font-bold text-text-primary mb-2">Welcome to CleanRoute Pro</h1>
                <p className="text-sm text-text-secondary leading-relaxed max-w-sm mx-auto mb-8">
                  You're not part of any organisation yet. Create your own business or join an existing one.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <button onClick={() => setView('create')}
                    className="btn-primary text-sm px-6 py-3 flex items-center justify-center gap-2">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    Create Organisation
                  </button>
                  <button onClick={() => setView('join')}
                    className="btn-ghost text-sm px-6 py-3 flex items-center justify-center gap-2 border border-border-light">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                      <line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
                    </svg>
                    Join an Organisation
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </APIProvider>
  );
}
