'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';

export default function SettingsPage() {
  const { profile, refreshProfile } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const [orgName, setOrgName] = useState(profile?.org_name || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSaveOrg = async () => {
    if (!profile?.org_id) return;
    setSaving(true);
    await supabase.from('organizations').update({ name: orgName }).eq('id', profile.org_id);
    await refreshProfile();
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="h-full overflow-y-auto p-4 lg:p-6 custom-scrollbar">
      <div className="max-w-[600px] mx-auto space-y-6">
        <div><h2 className="text-lg font-bold text-text-primary">Settings</h2><p className="text-sm text-text-secondary">Manage your business settings</p></div>

        <div className="card-elevated p-5 space-y-4">
          <h3 className="text-sm font-bold text-text-primary">Business Profile</h3>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Business Name</label>
            <input type="text" value={orgName} onChange={(e) => setOrgName(e.target.value)} className="input-field text-sm" />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleSaveOrg} disabled={saving} className="btn-primary text-sm">{saving ? 'Saving...' : 'Save Changes'}</button>
            {saved && <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-success font-medium">✓ Saved</motion.span>}
          </div>
        </div>

        <div className="card-elevated p-5 space-y-4">
          <h3 className="text-sm font-bold text-text-primary">Subscription</h3>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-semibold px-3 py-1 rounded-full capitalize ${profile?.subscription_status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
              {profile?.subscription_status || 'trialing'}
            </span>
            <span className="text-sm text-text-secondary capitalize">{profile?.subscription_tier || 'Pro'} Plan</span>
          </div>
          <p className="text-xs text-text-tertiary">Manage your subscription and billing through the Stripe Customer Portal.</p>
          <button className="btn-secondary text-sm" onClick={() => window.open('/api/stripe/portal', '_blank')}>Manage Subscription</button>
        </div>

        <div className="card-elevated p-5 space-y-4">
          <h3 className="text-sm font-bold text-text-primary">Account</h3>
          <div className="text-sm text-text-secondary space-y-1">
            <p><span className="text-text-tertiary">Email:</span> {profile?.email}</p>
            <p><span className="text-text-tertiary">Role:</span> <span className="capitalize">{profile?.role}</span></p>
          </div>
        </div>

        {profile?.is_platform_admin && (
          <a href="/admin" className="block card-elevated p-5 hover:border-primary transition-colors group">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/><circle cx="12" cy="10" r="3"/></svg>
              </div>
              <div><h4 className="text-sm font-bold text-text-primary">Platform Admin</h4><p className="text-xs text-text-tertiary">View all tenants and manage the platform</p></div>
            </div>
          </a>
        )}
      </div>
    </div>
  );
}
