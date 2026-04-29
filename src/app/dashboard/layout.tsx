import { createClient } from '@/lib/supabase/server';
import DashboardShell from './DashboardShell';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Fetch profile + org on the server — guaranteed to work with fresh cookies
  let serverProfile = null;
  if (user) {
    const { data: profileData } = await supabase
      .from('profiles')
      .select('id, org_id, full_name, email, role, is_platform_admin, onboarding_completed')
      .eq('id', user.id)
      .single();

    if (profileData) {
      const { data: orgData } = await supabase
        .from('organizations')
        .select('name, subscription_status, subscription_tier')
        .eq('id', profileData.org_id)
        .single();

      serverProfile = {
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
      };
    }
  }

  return <DashboardShell serverProfile={serverProfile}>{children}</DashboardShell>;
}
