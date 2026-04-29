'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

export default function OnboardingPage() {
  const { profile, refreshProfile } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [step, setStep] = useState(0);

  const handleComplete = async () => {
    if (!profile?.id) return;
    await supabase.from('profiles').update({ onboarding_completed: true }).eq('id', profile.id);
    await refreshProfile();
    router.push('/dashboard/schedule');
  };

  const steps = [
    { title: 'Welcome to CleanRoute Pro! 🎉', description: 'Let\'s get you set up in just a few steps. CleanRoute Pro helps you optimise your cleaning team\'s daily routes, saving time and fuel.', emoji: '👋' },
    { title: 'Your Teams', description: 'Create teams for each group of cleaners. Each team has its own base address, schedule, and route. You can add unlimited teams from the Schedule page.', emoji: '👥' },
    { title: 'Your Clients', description: 'Build your client database with addresses, contact details, and default job durations. Quick-add clients to any team\'s daily schedule.', emoji: '🏠' },
    { title: 'You\'re Ready!', description: 'Head to the Schedule page to start building your first route. Add clients, calculate travel times, and export your daily run sheet.', emoji: '🚀' },
  ];

  return (
    <div className="h-full overflow-y-auto flex items-center justify-center p-4 lg:p-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-[500px]">
        <div className="card-elevated p-8 text-center">
          <motion.div key={step} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <div className="text-5xl mb-4">{steps[step].emoji}</div>
            <h2 className="text-xl font-bold text-text-primary mb-2">{steps[step].title}</h2>
            <p className="text-sm text-text-secondary leading-relaxed">{steps[step].description}</p>
          </motion.div>

          <div className="flex items-center justify-center gap-1.5 my-6">
            {steps.map((_, i) => (
              <div key={i} className={`w-2 h-2 rounded-full transition-colors ${i === step ? 'bg-primary' : 'bg-border'}`} />
            ))}
          </div>

          <div className="flex gap-2 justify-center">
            {step > 0 && <button onClick={() => setStep(step - 1)} className="btn-ghost text-sm">Back</button>}
            {step < steps.length - 1 ? (
              <button onClick={() => setStep(step + 1)} className="btn-primary text-sm px-6">Next</button>
            ) : (
              <button onClick={handleComplete} className="btn-primary text-sm px-6">Get Started</button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
