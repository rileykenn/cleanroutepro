import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/staff/remove-org-member
 *
 * Revokes an org_members row directly by its ID.
 * Used for revoking accounts from the Accounts & Access tab where the
 * account holder may be an admin (not in staff_members) or a staff member
 * whose staff_member_id link needs to be reset.
 *
 * Body: { membershipId: string }
 */
export async function POST(request: NextRequest) {
  try {
    const serverSupabase = await createServerClient();
    const { data: { user } } = await serverSupabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await serverSupabase
      .from('profiles')
      .select('org_id, role')
      .eq('id', user.id)
      .single();

    if (!profile || profile.role !== 'owner') {
      return NextResponse.json({ error: 'Only the owner can revoke access' }, { status: 403 });
    }

    const body = await request.json();
    const { membershipId } = body;

    if (!membershipId) {
      return NextResponse.json({ error: 'Missing membershipId' }, { status: 400 });
    }

    const adminSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Fetch the membership — must belong to this org
    const { data: membership } = await adminSupabase
      .from('org_members')
      .select('id, user_id, org_id, role, staff_member_id')
      .eq('id', membershipId)
      .eq('org_id', profile.org_id)
      .single();

    if (!membership) {
      return NextResponse.json({ error: 'Membership not found' }, { status: 404 });
    }

    // Prevent revoking yourself
    if (membership.user_id === user.id) {
      return NextResponse.json({ error: 'You cannot revoke your own access' }, { status: 400 });
    }

    const linkedUserId = membership.user_id;

    // ── 1. Delete the org_members row ────────────────────────────────────
    await adminSupabase.from('org_members').delete().eq('id', membershipId);

    // ── 2. If linked to a staff_member, reset their invite fields ────────
    if (membership.staff_member_id) {
      await adminSupabase
        .from('staff_members')
        .update({ user_id: null, invite_status: null })
        .eq('id', membership.staff_member_id);
    }

    // ── 3. Check remaining org memberships for this user ─────────────────
    const { data: remaining } = await adminSupabase
      .from('org_members')
      .select('id')
      .eq('user_id', linkedUserId);

    const hasOtherOrgs = (remaining || []).length > 0;

    // ── 4. Detach user from this org if no remaining memberships ────────
    if (!hasOtherOrgs) {
      // Clear org_id + role so the user lands on the welcome screen on next login
      await adminSupabase
        .from('profiles')
        .update({ org_id: null, role: null })
        .eq('id', linkedUserId);
    } else {
      // Auto-switch to another org they still belong to
      const nextOrg = remaining![0];
      const { data: nextMembership } = await adminSupabase
        .from('org_members')
        .select('org_id, role')
        .eq('id', nextOrg.id)
        .single();
      if (nextMembership) {
        await adminSupabase
          .from('profiles')
          .update({ org_id: nextMembership.org_id, role: nextMembership.role })
          .eq('id', linkedUserId);
      }
    }

    return NextResponse.json({ success: true, accountDetached: !hasOtherOrgs });
  } catch (err) {
    console.error('[Remove Org Member] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
