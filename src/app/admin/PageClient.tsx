'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

interface Tenant { id: string; name: string; subscription_status: string; subscription_tier: string; created_at: string; profileCount: number; teamCount: number; clientCount: number; }

export default function AdminPageClient() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);

  const checkAuth = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/login'); return; }
    const { data: profile } = await supabase.from('profiles').select('is_platform_admin').eq('id', user.id).single();
    if (!profile?.is_platform_admin) { router.push('/dashboard/schedule'); return; }
    setAuthorized(true);
  }, [supabase, router]);

  const loadTenants = useCallback(async () => {
    const { data: orgs } = await supabase.from('organizations').select('*').order('created_at', { ascending: false });
    if (!orgs) { setLoading(false); return; }
    const list: Tenant[] = [];
    for (const org of orgs) {
      const { count: profileCount } = await supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('org_id', org.id);
      const { count: teamCount } = await supabase.from('teams').select('*', { count: 'exact', head: true }).eq('org_id', org.id);
      const { count: clientCount } = await supabase.from('clients').select('*', { count: 'exact', head: true }).eq('org_id', org.id);
      list.push({ id: org.id, name: org.name, subscription_status: org.subscription_status, subscription_tier: org.subscription_tier, created_at: org.created_at, profileCount: profileCount || 0, teamCount: teamCount || 0, clientCount: clientCount || 0 });
    }
    setTenants(list); setLoading(false);
  }, [supabase]);

  useEffect(() => { checkAuth().then(() => loadTenants()); }, [checkAuth, loadTenants]);

  if (!authorized) return null;

  const statusColors: Record<string, string> = { trialing: 'bg-blue-100 text-blue-700', active: 'bg-emerald-100 text-emerald-700', past_due: 'bg-amber-100 text-amber-700', canceled: 'bg-red-100 text-red-700' };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-[960px] mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div><h1 className="text-2xl font-bold text-text-primary">Platform Admin</h1><p className="text-sm text-text-secondary mt-0.5">{tenants.length} tenant{tenants.length !== 1 ? 's' : ''}</p></div>
          <a href="/dashboard/schedule" className="btn-ghost text-sm">← Dashboard</a>
        </div>
        {loading ? (
          <div className="space-y-3">{[1,2,3].map((i) => <div key={i} className="shimmer h-24 rounded-xl" />)}</div>
        ) : (
          <div className="space-y-3">
            {tenants.map((t, i) => (
              <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="card-elevated p-5">
                <div className="flex items-center justify-between mb-3">
                  <div><h3 className="text-base font-bold text-text-primary">{t.name}</h3><p className="text-xs text-text-tertiary mt-0.5">Created {new Date(t.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}</p></div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold px-3 py-1 rounded-full capitalize ${statusColors[t.subscription_status] || 'bg-gray-100 text-gray-700'}`}>{t.subscription_status}</span>
                    <span className="text-xs font-medium text-text-secondary capitalize">{t.subscription_tier} Plan</span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-surface-elevated rounded-lg p-3 text-center"><div className="text-lg font-bold text-text-primary">{t.profileCount}</div><div className="text-xs text-text-tertiary">Users</div></div>
                  <div className="bg-surface-elevated rounded-lg p-3 text-center"><div className="text-lg font-bold text-text-primary">{t.teamCount}</div><div className="text-xs text-text-tertiary">Teams</div></div>
                  <div className="bg-surface-elevated rounded-lg p-3 text-center"><div className="text-lg font-bold text-text-primary">{t.clientCount}</div><div className="text-xs text-text-tertiary">Clients</div></div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
