import { createClient } from '@/lib/supabase/server';
import DashboardShell from './DashboardShell';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let serverProfile = null;
  if (user) {
    const { data: profileData } = await supabase
      .from('profiles')
      .select('id, org_id, full_name, email, role, is_platform_admin, onboarding_completed')
      .eq('id', user.id)
      .single();

    if (profileData) {
      let orgName = '';
      let subscriptionStatus = 'trialing';
      let subscriptionTier = 'pro';

      // Only fetch org if they have one
      if (profileData.org_id) {
        const { data: orgData } = await supabase
          .from('organizations')
          .select('name, subscription_status, subscription_tier')
          .eq('id', profileData.org_id)
          .single();

        orgName = orgData?.name || '';
        subscriptionStatus = orgData?.subscription_status || 'trialing';
        subscriptionTier = orgData?.subscription_tier || 'pro';
      }

      serverProfile = {
        id: profileData.id,
        org_id: profileData.org_id || '',
        full_name: profileData.full_name,
        email: profileData.email,
        role: profileData.role as 'admin' | 'staff',
        is_platform_admin: profileData.is_platform_admin || false,
        onboarding_completed: profileData.onboarding_completed || false,
        org_name: orgName,
        subscription_status: subscriptionStatus,
        subscription_tier: subscriptionTier,
      };
    }
  }

  return <DashboardShell serverProfile={serverProfile}>{children}</DashboardShell>;
}
