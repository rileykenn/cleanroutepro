import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/staff/change-role
 *
 * Changes the role of an org member (admin, supervisor, or staff).
 * Updates both org_members.role and profiles.role.
 *
 * Body: { membershipId: string, newRole: 'admin' | 'supervisor' | 'staff' }
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
      return NextResponse.json({ error: 'Only admins can change roles' }, { status: 403 });
    }

    const body = await request.json();
    const { membershipId, newRole } = body;

    if (!membershipId || !newRole) {
      return NextResponse.json({ error: 'Missing membershipId or newRole' }, { status: 400 });
    }

    const validRoles = ['admin', 'supervisor', 'staff'];
    if (!validRoles.includes(newRole)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    const adminSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Fetch the membership — must belong to this org
    const { data: membership } = await adminSupabase
      .from('org_members')
      .select('id, user_id, org_id')
      .eq('id', membershipId)
      .single();

    if (!membership || membership.org_id !== profile.org_id) {
      return NextResponse.json({ error: 'Member not found in your org' }, { status: 404 });
    }

    // Prevent changing your own role
    if (membership.user_id === user.id) {
      return NextResponse.json({ error: 'Cannot change your own role' }, { status: 400 });
    }

    // Update org_members role
    const { error: omErr } = await adminSupabase
      .from('org_members')
      .update({ role: newRole })
      .eq('id', membershipId);

    if (omErr) {
      return NextResponse.json({ error: `org_members update failed: ${omErr.message}` }, { status: 500 });
    }

    // Update profiles role
    const { error: pErr } = await adminSupabase
      .from('profiles')
      .update({ role: newRole })
      .eq('id', membership.user_id);

    if (pErr) {
      return NextResponse.json({ error: `profiles update failed: ${pErr.message}` }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[change-role] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
