'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';

type Step = 'email' | 'code' | 'password';

export default function ForgotPasswordPage() {
  const supabase = createClient();
  const router = useRouter();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState(['', '', '', '', '', '', '', '']);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const codeRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  // Auto-focus first code input when entering code step
  useEffect(() => {
    if (step === 'code') {
      setTimeout(() => codeRefs.current[0]?.focus(), 100);
    }
  }, [step]);

  /* ─── Step 1: Send OTP to email ─── */
  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email);

    if (resetError) {
      setError(resetError.message);
      setLoading(false);
      return;
    }

    setLoading(false);
    setResendCooldown(60);
    setStep('code');
  };

  /* ─── Resend code ─── */
  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setError('');
    setLoading(true);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email);

    if (resetError) {
      setError(resetError.message);
      setLoading(false);
      return;
    }

    setResendCooldown(60);
    setLoading(false);
  };

  /* ─── Step 2: Verify OTP code ─── */
  const handleVerifyCode = useCallback(async (fullCode: string) => {
    setError('');
    setLoading(true);

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: fullCode,
      type: 'recovery',
    });

    if (verifyError) {
      setError('Invalid or expired code. Please try again.');
      setCode(['', '', '', '', '', '', '', '']);
      setLoading(false);
      setTimeout(() => codeRefs.current[0]?.focus(), 100);
      return;
    }

    setLoading(false);
    setStep('password');
  }, [email, supabase.auth]);

  /* ─── Step 3: Set new password ─── */
  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);

    setTimeout(() => router.push('/dashboard/schedule'), 2000);
  };

  /* ─── Code input handlers ─── */
  const handleCodeChange = (index: number, value: string) => {
    // Only allow digits
    const digit = value.replace(/\D/g, '').slice(-1);
    const newCode = [...code];
    newCode[index] = digit;
    setCode(newCode);

    // Auto-advance to next input
    if (digit && index < 7) {
      codeRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 8 digits entered
    if (digit && index === 7) {
      const fullCode = newCode.join('');
      if (fullCode.length === 8) {
        handleVerifyCode(fullCode);
      }
    }
  };

  const handleCodeKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      codeRefs.current[index - 1]?.focus();
    }
  };

  const handleCodePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 8);
    if (!pasted) return;

    const newCode = [...code];
    for (let i = 0; i < 8; i++) {
      newCode[i] = pasted[i] || '';
    }
    setCode(newCode);

    // Focus the next empty or last field
    const nextEmpty = newCode.findIndex((d) => !d);
    codeRefs.current[nextEmpty === -1 ? 7 : nextEmpty]?.focus();

    // Auto-submit if full code pasted
    if (pasted.length === 8) {
      handleVerifyCode(pasted);
    }
  };

  /* ─── Step indicator ─── */
  const stepNumber = step === 'email' ? 1 : step === 'code' ? 2 : 3;

  /* ─── Step icons ─── */
  const stepIcon = {
    email: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="M22 4L12 13L2 4" />
      </svg>
    ),
    code: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
    password: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z" />
        <path d="M9 12l2 2l4-4" />
      </svg>
    ),
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-[420px]"
      >
        <div className="card-elevated p-8">
          {/* ─── Step progress bar ─── */}
          <div className="flex items-center justify-center gap-2 mb-8">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center gap-2">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300"
                  style={{
                    background: s <= stepNumber ? 'var(--color-primary)' : 'var(--color-surface-hover)',
                    color: s <= stepNumber ? 'white' : 'var(--color-text-tertiary)',
                  }}
                >
                  {s < stepNumber ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  ) : (
                    s
                  )}
                </div>
                {s < 3 && (
                  <div
                    className="w-12 h-[2px] rounded-full transition-all duration-300"
                    style={{
                      background: s < stepNumber ? 'var(--color-primary)' : 'var(--color-border)',
                    }}
                  />
                )}
              </div>
            ))}
          </div>

          <AnimatePresence mode="wait">
            {/* ═══════ SUCCESS STATE ═══════ */}
            {success ? (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
                className="text-center space-y-4"
              >
                <div className="w-16 h-16 rounded-full bg-success-light flex items-center justify-center mx-auto">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </div>
                <div>
                  <p className="text-lg font-semibold text-text-primary">Password Updated</p>
                  <p className="text-sm text-text-secondary mt-1">
                    Redirecting you to the dashboard...
                  </p>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
              >
                {/* ─── Header ─── */}
                <div className="text-center mb-6">
                  <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-4">
                    {stepIcon[step]}
                  </div>
                  <h1 className="text-2xl font-bold text-text-primary">
                    {step === 'email' && 'Reset Password'}
                    {step === 'code' && 'Enter Code'}
                    {step === 'password' && 'New Password'}
                  </h1>
                  <p className="text-sm text-text-secondary mt-1">
                    {step === 'email' && 'Enter your email to receive a verification code'}
                    {step === 'code' && (
                      <>We sent a code to <span className="font-semibold text-text-primary">{email}</span></>
                    )}
                    {step === 'password' && 'Choose a strong password for your account'}
                  </p>
                </div>

                {/* ═══════ STEP 1: EMAIL ═══════ */}
                {step === 'email' && (
                  <form onSubmit={handleSendCode} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-1.5">
                        Email address
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="input-field"
                        placeholder="you@company.com"
                        required
                        autoFocus
                      />
                    </div>

                    {error && (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                        className="text-sm text-danger bg-danger-light rounded-lg p-3">{error}</motion.div>
                    )}

                    <button type="submit" disabled={loading}
                      className="btn-primary w-full py-3 disabled:opacity-50">
                      {loading ? 'Sending...' : 'Send Code'}
                    </button>
                  </form>
                )}

                {/* ═══════ STEP 2: OTP CODE ═══════ */}
                {step === 'code' && (
                  <div className="space-y-5">
                    <div className="flex justify-center gap-2.5" onPaste={handleCodePaste}>
                      {code.map((digit, i) => (
                        <input
                          key={i}
                          ref={(el) => { codeRefs.current[i] = el; }}
                          type="text"
                          inputMode="numeric"
                          maxLength={1}
                          value={digit}
                          onChange={(e) => handleCodeChange(i, e.target.value)}
                          onKeyDown={(e) => handleCodeKeyDown(i, e)}
                          disabled={loading}
                          className="w-10 h-12 text-center text-lg font-bold rounded-xl border transition-all duration-200 outline-none disabled:opacity-50"
                          style={{
                            borderColor: digit ? 'var(--color-primary)' : 'var(--color-border)',
                            background: digit ? 'var(--color-primary-light)' : 'var(--color-surface)',
                            color: 'var(--color-text-primary)',
                            boxShadow: digit ? '0 0 0 3px rgba(79, 70, 229, 0.1)' : 'none',
                          }}
                        />
                      ))}
                    </div>

                    {loading && (
                      <div className="flex items-center justify-center gap-2 text-sm text-text-secondary">
                        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                        Verifying...
                      </div>
                    )}

                    {error && (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                        className="text-sm text-danger bg-danger-light rounded-lg p-3 text-center">{error}</motion.div>
                    )}

                    <div className="text-center">
                      <p className="text-xs text-text-tertiary">
                        Didn&apos;t receive a code?{' '}
                        {resendCooldown > 0 ? (
                          <span className="text-text-tertiary">Resend in {resendCooldown}s</span>
                        ) : (
                          <button
                            onClick={handleResend}
                            disabled={loading}
                            className="text-primary font-medium hover:underline disabled:opacity-50"
                          >
                            Resend code
                          </button>
                        )}
                      </p>
                    </div>

                    <button
                      onClick={() => { setStep('email'); setCode(['', '', '', '', '', '', '', '']); setError(''); }}
                      className="w-full text-center text-sm text-text-secondary hover:text-text-primary transition-colors"
                    >
                      ← Use a different email
                    </button>
                  </div>
                )}

                {/* ═══════ STEP 3: NEW PASSWORD ═══════ */}
                {step === 'password' && (
                  <form onSubmit={handleSetPassword} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-1.5">
                        New Password
                      </label>
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="input-field"
                        placeholder="••••••••"
                        required
                        minLength={6}
                        autoFocus
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-1.5">
                        Confirm Password
                      </label>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="input-field"
                        placeholder="••••••••"
                        required
                        minLength={6}
                      />
                    </div>

                    {error && (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                        className="text-sm text-danger bg-danger-light rounded-lg p-3">{error}</motion.div>
                    )}

                    <button type="submit" disabled={loading}
                      className="btn-primary w-full py-3 disabled:opacity-50">
                      {loading ? 'Updating...' : 'Update Password'}
                    </button>
                  </form>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* ─── Back to login ─── */}
          {!success && (
            <p className="text-center text-sm text-text-tertiary mt-6">
              <Link href="/login" className="text-primary font-medium hover:underline">
                ← Back to Sign In
              </Link>
            </p>
          )}
        </div>
      </motion.div>
    </div>
  );
}
