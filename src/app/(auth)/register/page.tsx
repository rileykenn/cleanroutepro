'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';

export default function RegisterPage() {
  const supabase = createClient();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    const { error: authError } = await supabase.auth.signUp({
      email, password,
      options: { data: {} },
    });
    if (authError) { setError(authError.message); setLoading(false); return; }
    router.push('/dashboard');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        className="w-full max-w-[420px]">
        <div className="card-elevated p-8">
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-4">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-text-primary">Create Account</h1>
            <p className="text-sm text-text-secondary mt-1">Get started with CleanRoute Pro</p>
          </div>

          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                className="input-field" placeholder="you@example.com" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                className="input-field" placeholder="Minimum 6 characters" required minLength={6} />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">Confirm Password</label>
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                className="input-field" placeholder="Re-enter your password" required minLength={6} />
            </div>
            {error && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="text-sm text-danger bg-danger-light rounded-lg p-3">{error}</motion.div>
            )}
            <button type="submit" disabled={loading} className="btn-primary w-full py-3 disabled:opacity-50">
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>

          <p className="text-center text-sm text-text-tertiary mt-6">
            Already have an account?{' '}
            <a href="/login" className="text-primary font-medium hover:underline">Sign in</a>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
