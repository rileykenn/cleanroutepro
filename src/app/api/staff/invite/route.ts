import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    // Verify the requesting user is an admin
    const serverSupabase = await createServerClient();
    const { data: { user } } = await serverSupabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await serverSupabase
      .from('profiles')
      .select('org_id, role')
      .eq('id', user.id)
      .single();

    if (!profile || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can invite staff' }, { status: 403 });
    }

    const body = await request.json();
    const { staffMemberId, email, name } = body;

    if (!staffMemberId || !email) {
      return NextResponse.json({ error: 'Missing staffMemberId or email' }, { status: 400 });
    }

    // Verify this staff member belongs to the admin's org
    const { data: staffMember } = await serverSupabase
      .from('staff_members')
      .select('id, org_id, invite_status')
      .eq('id', staffMemberId)
      .eq('org_id', profile.org_id)
      .single();

    if (!staffMember) {
      return NextResponse.json({ error: 'Staff member not found' }, { status: 404 });
    }

    if (staffMember.invite_status === 'accepted') {
      return NextResponse.json({ error: 'Staff member already has an account' }, { status: 400 });
    }

    // Use admin API with service role key
    const adminSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Check if this email already has an account
    const { data: existingUsers } = await adminSupabase.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(u => u.email === email);

    if (existingUser) {
      // User already has an account — just link them to this org
      // Check if they're already a member of this org
      const { data: existingMember } = await adminSupabase
        .from('org_members')
        .select('id')
        .eq('user_id', existingUser.id)
        .eq('org_id', profile.org_id)
        .maybeSingle();

      if (existingMember) {
        return NextResponse.json({ error: 'This person already has access to your organisation' }, { status: 400 });
      }

      // Add them as a member of this org
      await adminSupabase.from('org_members').insert({
        user_id: existingUser.id,
        org_id: profile.org_id,
        role: 'staff',
        staff_member_id: staffMemberId,
      });

      // Link the staff_members record
      await adminSupabase
        .from('staff_members')
        .update({ user_id: existingUser.id, invite_status: 'accepted', email })
        .eq('id', staffMemberId);

      return NextResponse.json({ success: true, existing: true, message: 'Existing user linked to your organisation' });
    }

    // New user — send invite email
    const { data, error } = await adminSupabase.auth.admin.inviteUserByEmail(email, {
      data: {
        full_name: name || '',
        org_id: profile.org_id,
        staff_member_id: staffMemberId,
        role: 'staff',
      },
      redirectTo: `${request.nextUrl.origin}/auth/confirm`,
    });

    if (error) {
      console.error('[Staff Invite] Error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Mark invite as pending
    await serverSupabase
      .from('staff_members')
      .update({ invite_status: 'pending', email })
      .eq('id', staffMemberId);

    return NextResponse.json({ success: true, userId: data.user?.id });
  } catch (err) {
    console.error('[Staff Invite] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
