import { type EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Support both PKCE (token_hash) and implicit (code) flows
  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard/schedule';

  const redirectTo = request.nextUrl.clone();
  redirectTo.pathname = next;
  redirectTo.searchParams.delete('token_hash');
  redirectTo.searchParams.delete('type');
  redirectTo.searchParams.delete('code');
  redirectTo.searchParams.delete('next');

  const supabase = await createClient();

  // PKCE flow — token hash exchange
  if (token_hash && type) {
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error && data?.user) {
      const user = data.user;

      // ── Sync invite metadata for staff who accepted via email link ──────
      // When inviteUserByEmail is used, the staff_member_id and org_id are
      // stored in the user's auth metadata. We need to ensure both
      // org_members and staff_members reflect the accepted status.
      const meta = user.user_metadata ?? {};
      const staffMemberId: string | undefined = meta.staff_member_id;
      const orgId: string | undefined = meta.org_id;

      if (staffMemberId && orgId) {
        try {
          // Upsert org_members so it has the staff_member_id linked
          const { data: existingMembership } = await supabase
            .from('org_members')
            .select('id, status, staff_member_id')
            .eq('user_id', user.id)
            .eq('org_id', orgId)
            .maybeSingle();

          if (existingMembership) {
            // Update existing row — set accepted + link staff_member_id
            await supabase
              .from('org_members')
              .update({ status: 'accepted', staff_member_id: staffMemberId })
              .eq('id', existingMembership.id);
          } else {
            // No row yet — create it
            await supabase.from('org_members').insert({
              user_id: user.id,
              org_id: orgId,
              role: 'staff',
              staff_member_id: staffMemberId,
              status: 'accepted',
            });
          }

          // Sync staff_members.invite_status → 'accepted'
          await supabase
            .from('staff_members')
            .update({ invite_status: 'accepted', user_id: user.id })
            .eq('id', staffMemberId);

          // Ensure their profile has the correct org + role
          await supabase
            .from('profiles')
            .update({ org_id: orgId, role: 'staff' })
            .eq('id', user.id);
        } catch (syncErr) {
          console.error('[Auth Confirm] Failed to sync invite metadata:', syncErr);
          // Non-fatal — user is still authenticated, just redirect normally
        }
      }
      // ────────────────────────────────────────────────────────────────────

      const { data: profile } = await supabase.from('profiles').select('role, org_id').eq('id', user.id).maybeSingle();
      if (!profile?.org_id) {
        redirectTo.pathname = '/dashboard';
      } else if (profile?.role === 'staff') {
        redirectTo.pathname = '/dashboard/staff-view';
      }
      return NextResponse.redirect(redirectTo);
    }
  }

  // Implicit / OAuth flow — code exchange
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(redirectTo);
    }
  }

  // Something went wrong — send back to login with error
  redirectTo.pathname = '/login';
  redirectTo.searchParams.set('error', 'auth_callback_failed');
  return NextResponse.redirect(redirectTo);
}
