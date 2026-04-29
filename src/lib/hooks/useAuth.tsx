'use client';

import { useState, useEffect, createContext, useContext, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';

export interface UserProfile {
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

export function AuthProvider({ children, serverProfile }: { children: React.ReactNode; serverProfile?: UserProfile | null }) {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  // Initialize with server profile — this is the key fix for page refresh
  const [profile, setProfile] = useState<UserProfile | null>(serverProfile ?? null);
  const [loading, setLoading] = useState(!serverProfile); // Not loading if we have server data
  const profileLoadedFor = useRef<string | null>(serverProfile?.id ?? null);

  const loadProfile = useCallback(async (userId: string) => {
    if (profileLoadedFor.current === userId) return;
    profileLoadedFor.current = userId;

    try {
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
    // Listen for auth state changes (sign in, sign out, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event: string, session: { user: User } | null) => {
        const currentUser = session?.user ?? null;
        setUser(currentUser);

        if (currentUser) {
          // Only load profile from client if we don't already have server data
          if (!profileLoadedFor.current) {
            await loadProfile(currentUser.id);
          }
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
