'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { getAppTimezone, setAppTimezone, TIMEZONE_OPTIONS } from '@/lib/timezone';

export default function SettingsPage() {
  const { profile, refreshProfile } = useAuth();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  // Admin-only page
  useEffect(() => {
    if (profile && profile.role !== 'owner' && profile.role !== 'admin') {
      router.replace('/dashboard/schedule');
    }
  }, [profile?.role, router]);
  const [orgName, setOrgName] = useState(profile?.org_name || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Timezone state — initialized from the global module (which was set by auth hook)
  const [timezone, setTimezone] = useState(getAppTimezone());
  const [tzSaving, setTzSaving] = useState(false);
  const [tzSaved, setTzSaved] = useState(false);

  // Org-level defaults for new teams
  const [defaults, setDefaults] = useState({
    default_hourly_rate: 38,
    default_fuel_efficiency: 10,
    default_fuel_price: 1.85,
    default_per_km_rate: 0,
  });
  const [defaultsSaving, setDefaultsSaving] = useState(false);
  const [defaultsSaved, setDefaultsSaved] = useState(false);

  // Payroll cycle start day
  const [payrollStartDay, setPayrollStartDay] = useState(1);
  const [payrollSaving, setPayrollSaving] = useState(false);
  const [payrollSaved, setPayrollSaved] = useState(false);

  // Sync timezone state when profile loads
  useEffect(() => {
    setTimezone(getAppTimezone());
  }, [profile]);

  // Load org defaults
  useEffect(() => {
    if (!profile?.org_id) return;
    supabase
      .from('organizations')
      .select('default_hourly_rate, default_fuel_efficiency, default_fuel_price, default_per_km_rate, payroll_cycle_start_day')
      .eq('id', profile.org_id)
      .single()
      .then(({ data }: { data: any }) => {
        if (data) {
          setDefaults({
            default_hourly_rate: Number(data.default_hourly_rate) || 38,
            default_fuel_efficiency: Number(data.default_fuel_efficiency) || 10,
            default_fuel_price: Number(data.default_fuel_price) || 1.85,
            default_per_km_rate: Number(data.default_per_km_rate) || 0,
          });
          setPayrollStartDay(data.payroll_cycle_start_day ?? 1);
        }
      });
  }, [supabase, profile?.org_id]);

  const handleSaveOrg = async () => {
    if (!profile?.org_id) return;
    setSaving(true);
    await supabase.from('organizations').update({ name: orgName }).eq('id', profile.org_id);
    await refreshProfile();
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSaveTimezone = async () => {
    if (!profile?.org_id) return;
    setTzSaving(true);
    await supabase.from('organizations').update({ timezone }).eq('id', profile.org_id);
    setAppTimezone(timezone);
    await refreshProfile();
    setTzSaving(false); setTzSaved(true);
    setTimeout(() => setTzSaved(false), 2000);
  };

  const handleSaveDefaults = async () => {
    if (!profile?.org_id) return;
    setDefaultsSaving(true);
    await supabase.from('organizations').update(defaults).eq('id', profile.org_id);
    setDefaultsSaving(false); setDefaultsSaved(true);
    setTimeout(() => setDefaultsSaved(false), 2000);
  };

  const handleSavePayrollCycle = async () => {
    if (!profile?.org_id) return;
    setPayrollSaving(true);
    await supabase.from('organizations').update({ payroll_cycle_start_day: payrollStartDay }).eq('id', profile.org_id);
    setPayrollSaving(false); setPayrollSaved(true);
    setTimeout(() => setPayrollSaved(false), 2000);
  };

  // Detect browser timezone for the label
  const browserTz = useMemo(() => {
    if (typeof Intl !== 'undefined') {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
    return 'Unknown';
  }, []);

  return (
    <div className="h-full overflow-y-auto p-4 lg:p-6 custom-scrollbar pb-20 lg:pb-6">
      <div className="max-w-[600px] mx-auto space-y-6">
        <div><h2 className="text-lg font-bold text-text-primary">Organisation Settings</h2><p className="text-sm text-text-secondary">Manage your organisation's settings</p></div>

        {/* Business Profile */}
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

        {/* Timezone Setting */}
        <div className="card-elevated p-5 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-text-primary">Timezone</h3>
            <p className="text-xs text-text-tertiary mt-0.5">All dates and times across the app will display in this timezone.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Business Timezone</label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="input-field text-sm w-full"
            >
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-text-tertiary mt-1.5">
              Your browser timezone: <span className="font-medium text-text-secondary">{browserTz}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleSaveTimezone} disabled={tzSaving} className="btn-primary text-sm">
              {tzSaving ? 'Saving...' : 'Save Timezone'}
            </button>
            {tzSaved && <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-success font-medium">✓ Saved</motion.span>}
          </div>
        </div>

        {/* ── Scheduling Defaults ─────────────────────────────────────────── */}
        {profile?.role === 'owner' && (
        <div className="card-elevated p-5 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-text-primary">Scheduling Defaults</h3>
            <p className="text-xs text-text-tertiary mt-0.5">
              These values pre-fill new teams. Existing teams keep their own rates and can be updated individually in the schedule view.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Hourly Rate */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Default Hourly Rate</label>
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-text-tertiary">$</span>
                <input
                  type="number" min={0} step={0.5}
                  value={defaults.default_hourly_rate}
                  onChange={e => setDefaults(d => ({ ...d, default_hourly_rate: parseFloat(e.target.value) || 0 }))}
                  className="input-field text-sm"
                />
                <span className="text-xs text-text-tertiary whitespace-nowrap">/hr</span>
              </div>
            </div>

            {/* Fuel Efficiency */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Fuel Efficiency</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number" min={0} step={0.5}
                  value={defaults.default_fuel_efficiency}
                  onChange={e => setDefaults(d => ({ ...d, default_fuel_efficiency: parseFloat(e.target.value) || 0 }))}
                  className="input-field text-sm"
                />
                <span className="text-xs text-text-tertiary whitespace-nowrap">L/100km</span>
              </div>
            </div>

            {/* Fuel Price */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Fuel Price</label>
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-text-tertiary">$</span>
                <input
                  type="number" min={0} step={0.01}
                  value={defaults.default_fuel_price}
                  onChange={e => setDefaults(d => ({ ...d, default_fuel_price: parseFloat(e.target.value) || 0 }))}
                  className="input-field text-sm"
                />
                <span className="text-xs text-text-tertiary whitespace-nowrap">/litre</span>
              </div>
            </div>

            {/* Per-km Allowance */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Per-km Allowance</label>
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-text-tertiary">$</span>
                <input
                  type="number" min={0} step={0.01}
                  value={defaults.default_per_km_rate}
                  onChange={e => setDefaults(d => ({ ...d, default_per_km_rate: parseFloat(e.target.value) || 0 }))}
                  className="input-field text-sm"
                />
                <span className="text-xs text-text-tertiary whitespace-nowrap">/km</span>
              </div>
              <p className="text-[11px] text-text-tertiary mt-1">Set to 0 to use fuel cost calculation instead</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={handleSaveDefaults} disabled={defaultsSaving} className="btn-primary text-sm">
              {defaultsSaving ? 'Saving...' : 'Save Defaults'}
            </button>
            {defaultsSaved && <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-success font-medium">✓ Saved</motion.span>}
          </div>
        </div>
        )}

        {/* ── Payroll Settings ────────────────────────────────────────────── */}
        {profile?.role === 'owner' && (
        <div className="card-elevated p-5 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-text-primary">Payroll Settings</h3>
            <p className="text-xs text-text-tertiary mt-0.5">Configure your organization's payroll cycle.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Payroll Cycle Start Day</label>
            <select
              value={payrollStartDay}
              onChange={(e) => setPayrollStartDay(Number(e.target.value))}
              className="input-field text-sm w-full"
            >
              <option value={0}>Sunday</option>
              <option value={1}>Monday</option>
              <option value={2}>Tuesday</option>
              <option value={3}>Wednesday</option>
              <option value={4}>Thursday</option>
              <option value={5}>Friday</option>
              <option value={6}>Saturday</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleSavePayrollCycle} disabled={payrollSaving} className="btn-primary text-sm">
              {payrollSaving ? 'Saving...' : 'Save Payroll Cycle'}
            </button>
            {payrollSaved && <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-success font-medium">✓ Saved</motion.span>}
          </div>
        </div>
        )}

        {/* Subscription */}
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

        {/* Account Info */}
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
