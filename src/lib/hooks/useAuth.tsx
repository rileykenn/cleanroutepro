'use client';

import { useState, useEffect, createContext, useContext, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';

interface UserProfile {
  id: string;
  org_id: string;
  full_name: string;
  email: string;
  role: 'admin' | 'staff';
  is_platform_admin: boolean;
  onboarding_completed: boolean;
  org_name: string;
  subscription_status: string;
  subscription_tier: string;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null, profile: null, loading: true,
  signOut: async () => {}, refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const profileLoadedFor = useRef<string | null>(null);

  const loadProfile = useCallback(async (userId: string) => {
    // Prevent duplicate loads for the same user
    if (profileLoadedFor.current === userId) return;
    profileLoadedFor.current = userId;

    try {
      // Load profile and org as separate queries to keep it simple
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('id, org_id, full_name, email, role, is_platform_admin, onboarding_completed')
        .eq('id', userId)
        .single();

      if (profileError || !profileData) {
        console.error('[Auth] Profile query failed:', profileError?.message);
        profileLoadedFor.current = null;
        return;
      }

      const { data: orgData } = await supabase
        .from('organizations')
        .select('name, subscription_status, subscription_tier')
        .eq('id', profileData.org_id)
        .single();

      setProfile({
        id: profileData.id,
        org_id: profileData.org_id,
        full_name: profileData.full_name,
        email: profileData.email,
        role: profileData.role as 'admin' | 'staff',
        is_platform_admin: profileData.is_platform_admin || false,
        onboarding_completed: profileData.onboarding_completed || false,
        org_name: orgData?.name || '',
        subscription_status: orgData?.subscription_status || 'trialing',
        subscription_tier: orgData?.subscription_tier || 'pro',
      });
    } catch (err) {
      console.error('[Auth] Unexpected error loading profile:', err);
      profileLoadedFor.current = null;
    }
  }, [supabase]);

  useEffect(() => {
    // Use ONLY onAuthStateChange — it fires INITIAL_SESSION on mount.
    // This avoids the Navigator Lock race condition caused by
    // calling getUser() and onAuthStateChange simultaneously.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event: string, session: { user: User } | null) => {
        const currentUser = session?.user ?? null;
        setUser(currentUser);

        if (currentUser) {
          await loadProfile(currentUser.id);
        } else {
          setProfile(null);
          profileLoadedFor.current = null;
        }

        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, [supabase, loadProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    profileLoadedFor.current = null;
  }, [supabase]);

  const refreshProfile = useCallback(async () => {
    if (user) {
      profileLoadedFor.current = null;
      await loadProfile(user.id);
    }
  }, [user, loadProfile]);

  return (
    <AuthContext.Provider value={{ user, profile, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() { return useContext(AuthContext); }
