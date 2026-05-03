'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { APIProvider } from '@vis.gl/react-google-maps';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import PlacesAutocomplete from '@/components/PlacesAutocomplete';
import { Location } from '@/lib/types';

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

export default function OnboardingPage() {
  const { profile, refreshProfile } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // Step 1: Business name
  const [businessName, setBusinessName] = useState('');

  // Step 2: Team + base address
  const [teamName, setTeamName] = useState('Team 1');
  const [baseAddress, setBaseAddress] = useState<Location | null>(null);

  // Step 3: First client
  const [clientName, setClientName] = useState('');
  const [clientAddress, setClientAddress] = useState<Location | null>(null);
  const [clientDuration, setClientDuration] = useState(2);

  const handleComplete = useCallback(async () => {
    if (!profile?.id || !profile?.org_id || saving) return;
    setSaving(true);

    try {
      // Update business name
      if (businessName.trim()) {
        await supabase.from('organizations').update({ name: businessName.trim() }).eq('id', profile.org_id);
      }

      // Create first team
      if (teamName.trim()) {
        const teamInsert: Record<string, unknown> = {
          org_id: profile.org_id, name: teamName.trim(), color_index: 0, sort_order: 0,
        };
        if (baseAddress) {
          teamInsert.base_address = baseAddress.address;
          teamInsert.base_lat = baseAddress.lat;
          teamInsert.base_lng = baseAddress.lng;
          teamInsert.base_place_id = baseAddress.placeId || null;
        }

        // Check if team already exists (in case they retry)
        const { data: existingTeams } = await supabase.from('teams').select('id').eq('org_id', profile.org_id).limit(1);
        if (!existingTeams || existingTeams.length === 0) {
          await supabase.from('teams').insert(teamInsert);
        } else {
          // Update the existing team
          await supabase.from('teams').update(teamInsert).eq('id', existingTeams[0].id);
        }
      }

      // Create first client
      if (clientName.trim() && clientAddress) {
        const { data: existingClients } = await supabase.from('clients').select('id').eq('org_id', profile.org_id).eq('name', clientName.trim()).limit(1);
        if (!existingClients || existingClients.length === 0) {
          await supabase.from('clients').insert({
            org_id: profile.org_id, name: clientName.trim(),
            address: clientAddress.address, lat: clientAddress.lat, lng: clientAddress.lng,
            place_id: clientAddress.placeId || null,
            default_duration_minutes: Math.round(clientDuration * 60),
          });
        }
      }

      // Mark onboarding complete
      await supabase.from('profiles').update({ onboarding_completed: true }).eq('id', profile.id);
      await refreshProfile();
      router.push('/dashboard/schedule');
    } catch (err) {
      console.error('[Onboarding] Error:', err);
      setSaving(false);
    }
  }, [profile, supabase, businessName, teamName, baseAddress, clientName, clientAddress, clientDuration, refreshProfile, router, saving]);

  const steps = [
    {
      title: 'Welcome to CleanRoute Pro! 🎉',
      description: "Let's get you set up. We'll walk through creating your business profile, your first team, and your first client.",
      emoji: '👋',
      content: null,
      canProceed: true,
    },
    {
      title: 'Your Business',
      description: 'What is your business name?',
      emoji: '🏢',
      content: (
        <div className="mt-5 space-y-3 text-left">
          <label className="text-xs font-medium text-text-secondary">Business Name</label>
          <input
            type="text" value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="e.g. The Cleaning Co Shellharbour"
            className="input-field w-full text-sm"
            autoFocus
          />
        </div>
      ),
      canProceed: businessName.trim().length > 0,
    },
    {
      title: 'Your First Team',
      description: 'Create your first team and set a base address (where your day starts and ends).',
      emoji: '👥',
      content: (
        <div className="mt-5 space-y-4 text-left">
          <div>
            <label className="text-xs font-medium text-text-secondary">Team Name</label>
            <input
              type="text" value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="e.g. Team 1"
              className="input-field w-full text-sm mt-1"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-text-secondary">Base Address</label>
            <div className="mt-1">
              <PlacesAutocomplete
                onPlaceSelect={setBaseAddress}
                placeholder="Search for your base address..."
              />
            </div>
            {baseAddress && (
              <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                {baseAddress.address}
              </p>
            )}
          </div>
        </div>
      ),
      canProceed: teamName.trim().length > 0,
    },
    {
      title: 'Your First Client',
      description: 'Add your first client to the database. You can skip this and add clients later.',
      emoji: '🏠',
      content: (
        <div className="mt-5 space-y-4 text-left">
          <div>
            <label className="text-xs font-medium text-text-secondary">Client Name</label>
            <input
              type="text" value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g. Mrs Smith"
              className="input-field w-full text-sm mt-1"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-text-secondary">Client Address</label>
            <div className="mt-1">
              <PlacesAutocomplete
                onPlaceSelect={setClientAddress}
                placeholder="Search for client address..."
              />
            </div>
            {clientAddress && (
              <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                {clientAddress.address}
              </p>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-text-secondary">Default Job Duration (hours)</label>
            <input
              type="number" value={clientDuration}
              onChange={(e) => setClientDuration(parseFloat(e.target.value) || 1)}
              min={0.25} step={0.25}
              className="input-field w-24 text-sm mt-1 text-center"
            />
          </div>
        </div>
      ),
      canProceed: true, // Can skip
    },
    {
      title: "You're All Set! 🚀",
      description: "Head to the Schedule page to start building your first route. Add clients, calculate travel times, and manage your teams.",
      emoji: '✅',
      content: (
        <div className="mt-4 space-y-2 text-left bg-surface-elevated rounded-xl p-4 text-sm">
          {businessName && <div className="flex items-center gap-2"><span className="text-green-500">✓</span> <span className="text-text-secondary">Business:</span> <span className="font-medium">{businessName}</span></div>}
          {teamName && <div className="flex items-center gap-2"><span className="text-green-500">✓</span> <span className="text-text-secondary">Team:</span> <span className="font-medium">{teamName}</span></div>}
          {baseAddress && <div className="flex items-center gap-2"><span className="text-green-500">✓</span> <span className="text-text-secondary">Base:</span> <span className="font-medium text-xs">{baseAddress.address}</span></div>}
          {clientName && <div className="flex items-center gap-2"><span className="text-green-500">✓</span> <span className="text-text-secondary">Client:</span> <span className="font-medium">{clientName}</span></div>}
        </div>
      ),
      canProceed: true,
    },
  ];

  const isLastStep = step === steps.length - 1;

  return (
    <APIProvider apiKey={MAPS_KEY} libraries={['places']}>
      <div className="h-full overflow-y-auto flex items-center justify-center p-4 lg:p-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-[500px]">
          <div className="card-elevated p-8">
            <AnimatePresence mode="wait">
              <motion.div key={step} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="text-center">
                <div className="text-5xl mb-4">{steps[step].emoji}</div>
                <h2 className="text-xl font-bold text-text-primary mb-2">{steps[step].title}</h2>
                <p className="text-sm text-text-secondary leading-relaxed">{steps[step].description}</p>
                {steps[step].content}
              </motion.div>
            </AnimatePresence>

            {/* Progress dots */}
            <div className="flex items-center justify-center gap-1.5 my-6">
              {steps.map((_, i) => (
                <div key={i} className={`w-2 h-2 rounded-full transition-colors ${i === step ? 'bg-primary' : i < step ? 'bg-green-400' : 'bg-border'}`} />
              ))}
            </div>

            {/* Navigation */}
            <div className="flex gap-2 justify-center">
              {step > 0 && <button onClick={() => setStep(step - 1)} className="btn-ghost text-sm">Back</button>}
              {!isLastStep ? (
                <button
                  onClick={() => setStep(step + 1)}
                  disabled={!steps[step].canProceed}
                  className="btn-primary text-sm px-6 disabled:opacity-40"
                >
                  {step === 3 && !clientName.trim() ? 'Skip' : 'Next'}
                </button>
              ) : (
                <button
                  onClick={handleComplete}
                  disabled={saving}
                  className="btn-primary text-sm px-6 disabled:opacity-60"
                >
                  {saving ? 'Setting up...' : 'Go to Schedule →'}
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </APIProvider>
  );
}
