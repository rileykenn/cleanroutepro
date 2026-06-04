import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/staff/remove
 *
 * Body: { staffMemberId: string, revokeAccountOnly?: boolean }
 *
 * - If revokeAccountOnly=true: removes the staff member's access to this org
 *   (deletes org_members row, resets staff_members.invite_status + user_id)
 *   but keeps the staff_members record so they stay in the roster.
 *
 * - If revokeAccountOnly=false (default): also deletes the staff_members record
 *   from the roster entirely.
 *
 * In both cases, if the user has no remaining org memberships after removal,
 * their Supabase auth account is also deleted.
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

    if (!profile || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can remove staff' }, { status: 403 });
    }

    const body = await request.json();
    const { staffMemberId, revokeAccountOnly = false } = body;

    if (!staffMemberId) {
      return NextResponse.json({ error: 'Missing staffMemberId' }, { status: 400 });
    }

    // Fetch the staff member — must belong to this org
    const { data: staffMember } = await serverSupabase
      .from('staff_members')
      .select('id, org_id, user_id, invite_status, name')
      .eq('id', staffMemberId)
      .eq('org_id', profile.org_id)
      .single();

    if (!staffMember) {
      return NextResponse.json({ error: 'Staff member not found' }, { status: 404 });
    }

    const adminSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const linkedUserId = staffMember.user_id;

    // ── 1. Remove org_members row (revokes portal access) ──────────────────
    if (linkedUserId) {
      await adminSupabase
        .from('org_members')
        .delete()
        .eq('user_id', linkedUserId)
        .eq('org_id', profile.org_id);

      // ── 2. Reset the staff_members invite fields ─────────────────────────
      await adminSupabase
        .from('staff_members')
        .update({ user_id: null, invite_status: null })
        .eq('id', staffMemberId);

      // ── 3. Check if user has any remaining orgs ───────────────────────────
      const { data: remainingMemberships } = await adminSupabase
        .from('org_members')
        .select('id')
        .eq('user_id', linkedUserId);

      const hasOtherOrgs = (remainingMemberships || []).length > 0;

      // ── 4. Delete the auth account if no remaining orgs ───────────────────
      if (!hasOtherOrgs) {
        await adminSupabase.auth.admin.deleteUser(linkedUserId);
        // Also clean up the profile
        await adminSupabase.from('profiles').delete().eq('id', linkedUserId);
      }
    }

    // ── 5. Optionally delete the staff_members row entirely ─────────────────
    if (!revokeAccountOnly) {
      // Clean up foreign keys before deleting
      await adminSupabase.from('staff_assignments').delete().eq('staff_id', staffMemberId);
      await adminSupabase.from('schedules').update({ driver_staff_id: null }).eq('driver_staff_id', staffMemberId);
      await adminSupabase.from('org_members').delete().eq('staff_member_id', staffMemberId);
      
      const { error: delErr } = await adminSupabase.from('staff_members').delete().eq('id', staffMemberId);
      if (delErr) {
        console.error('Error deleting staff member:', delErr);
        return NextResponse.json({ error: 'Failed to delete staff member. ' + delErr.message }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      revokedAccountOnly: revokeAccountOnly,
      deletedAuthAccount: !!linkedUserId,
    });
  } catch (err) {
    console.error('[Staff Remove] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
