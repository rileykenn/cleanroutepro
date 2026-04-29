'use client';

import { useState, useEffect, createContext, useContext, useCallback, useMemo } from 'react';
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

  const loadProfile = useCallback(async (userId: string) => {
    try {
      // Try loading profile with org join
      const { data, error } = await supabase
        .from('profiles')
        .select('id, org_id, full_name, email, role, is_platform_admin, onboarding_completed, organizations(name, subscription_status, subscription_tier)')
        .eq('id', userId)
        .single();

      if (error) {
        console.error('[Auth] Profile query error:', error.message, error.code, error.details);
        // Fallback: try loading profile without the join
        const { data: profileOnly, error: fallbackError } = await supabase
          .from('profiles')
          .select('id, org_id, full_name, email, role, is_platform_admin, onboarding_completed')
          .eq('id', userId)
          .single();
        
        if (fallbackError) {
          console.error('[Auth] Fallback profile query also failed:', fallbackError.message);
          return;
        }

        if (profileOnly) {
          // Load org separately
          const { data: orgData } = await supabase
            .from('organizations')
            .select('name, subscription_status, subscription_tier')
            .eq('id', profileOnly.org_id)
            .single();

          setProfile({
            id: profileOnly.id, org_id: profileOnly.org_id,
            full_name: profileOnly.full_name, email: profileOnly.email,
            role: profileOnly.role as 'admin' | 'staff',
            is_platform_admin: profileOnly.is_platform_admin || false,
            onboarding_completed: profileOnly.onboarding_completed || false,
            org_name: orgData?.name || '',
            subscription_status: orgData?.subscription_status || 'trialing',
            subscription_tier: orgData?.subscription_tier || 'pro',
          });
        }
        return;
      }

      if (data) {
        const org = data.organizations as unknown as { name: string; subscription_status: string; subscription_tier: string } | null;
        setProfile({
          id: data.id, org_id: data.org_id, full_name: data.full_name, email: data.email,
          role: data.role as 'admin' | 'staff',
          is_platform_admin: data.is_platform_admin || false,
          onboarding_completed: data.onboarding_completed || false,
          org_name: org?.name || '', subscription_status: org?.subscription_status || 'trialing',
          subscription_tier: org?.subscription_tier || 'pro',
        });
      }
    } catch (err) {
      console.error('[Auth] Unexpected error loading profile:', err);
    }
  }, [supabase]);

  useEffect(() => {
    const init = async () => {
      console.log('[Auth] init: fetching user...');
      const { data: { user: currentUser }, error: userError } = await supabase.auth.getUser();
      if (userError) console.error('[Auth] getUser error:', userError.message);
      console.log('[Auth] init: user =', currentUser?.id || 'null', currentUser?.email || '');
      setUser(currentUser);
      if (currentUser) {
        console.log('[Auth] init: loading profile for', currentUser.id);
        await loadProfile(currentUser.id);
        console.log('[Auth] init: profile loaded');
      }
      setLoading(false);
    };
    init();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event: string, session: { user: User } | null) => {
        console.log('[Auth] onAuthStateChange:', _event, session?.user?.email || 'no session');
        const newUser = session?.user || null;
        setUser(newUser);
        if (newUser) await loadProfile(newUser.id);
        else setProfile(null);
      }
    );
    return () => subscription.unsubscribe();
  }, [supabase, loadProfile]);

  const signOut = useCallback(async () => { await supabase.auth.signOut(); setUser(null); setProfile(null); }, [supabase]);
  const refreshProfile = useCallback(async () => { if (user) await loadProfile(user.id); }, [user, loadProfile]);

  return (
    <AuthContext.Provider value={{ user, profile, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() { return useContext(AuthContext); }
