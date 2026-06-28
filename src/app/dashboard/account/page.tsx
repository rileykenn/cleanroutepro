'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/hooks/useAuth';

export default function AccountPage() {
  const supabase = createClient();
  const { profile, refreshProfile } = useAuth();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Password change
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || '');
      setEmail(profile.email || '');
    }
  }, [profile]);

  async function handleSaveProfile() {
    if (!profile) return;
    setSaving(true);
    setSaved(false);

    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName })
      .eq('id', profile.id);

    if (!error) {
      setSaved(true);
      refreshProfile();
      setTimeout(() => setSaved(false), 2000);
    }
    setSaving(false);
  }

  async function handleChangePassword() {
    if (!newPassword || !confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'Please fill in both fields.' });
      return;
    }
    if (newPassword.length < 6) {
      setPasswordMessage({ type: 'error', text: 'Password must be at least 6 characters.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'Passwords do not match.' });
      return;
    }

    setPasswordSaving(true);
    setPasswordMessage(null);

    const { error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      setPasswordMessage({ type: 'error', text: error.message });
    } else {
      setPasswordMessage({ type: 'success', text: 'Password updated successfully.' });
      setNewPassword('');
      setConfirmPassword('');
    }
    setPasswordSaving(false);
  }

  return (
    <div className="h-full overflow-y-auto p-4 lg:p-6 custom-scrollbar pb-20 lg:pb-6">
      <div className="max-w-[600px] mx-auto space-y-6">
        <div>
          <h2 className="text-lg font-bold text-text-primary">My Account</h2>
          <p className="text-sm text-text-secondary">Manage your personal account settings</p>
        </div>

        {/* ── Profile ────────────────────────────────────────────────── */}
        <div className="card-elevated p-5 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-text-primary">Profile</h3>
            <p className="text-xs text-text-tertiary mt-0.5">Your personal information</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Display Name</label>
            <input
              type="text"
              className="input-field text-sm"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your name"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Email</label>
            <input
              type="email"
              className="input-field text-sm bg-surface-secondary"
              value={email}
              readOnly
              disabled
            />
            <p className="text-xs text-text-tertiary mt-1">Email cannot be changed here. Contact support if needed.</p>
          </div>

          <button
            onClick={handleSaveProfile}
            disabled={saving || fullName === (profile?.full_name || '')}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Changes'}
          </button>
        </div>

        {/* ── Password ───────────────────────────────────────────────── */}
        <div className="card-elevated p-5 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-text-primary">Change Password</h3>
            <p className="text-xs text-text-tertiary mt-0.5">Update your login password</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">New Password</label>
            <input
              type="password"
              className="input-field text-sm"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 6 characters"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Confirm Password</label>
            <input
              type="password"
              className="input-field text-sm"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
            />
          </div>

          {passwordMessage && (
            <p className={`text-xs font-medium ${passwordMessage.type === 'error' ? 'text-danger' : 'text-emerald-600'}`}>
              {passwordMessage.text}
            </p>
          )}

          <button
            onClick={handleChangePassword}
            disabled={passwordSaving || !newPassword || !confirmPassword}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {passwordSaving ? 'Updating…' : 'Update Password'}
          </button>
        </div>

        {/* ── Account Info ────────────────────────────────────────────── */}
        <div className="card-elevated p-5 space-y-3">
          <div>
            <h3 className="text-sm font-bold text-text-primary">Account Info</h3>
            <p className="text-xs text-text-tertiary mt-0.5">Read-only details about your account</p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-text-tertiary">Email</p>
              <p className="text-text-primary font-medium">{email}</p>
            </div>
            <div>
              <p className="text-xs text-text-tertiary">Role</p>
              <p className="text-text-primary font-medium capitalize">{profile?.role || 'No role'}</p>
            </div>
            <div>
              <p className="text-xs text-text-tertiary">Organisation</p>
              <p className="text-text-primary font-medium">{profile?.org_name || 'None'}</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
