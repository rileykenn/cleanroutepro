import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { membershipId, action } = await request.json();
    if (!membershipId || !['accept', 'decline'].includes(action)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    // Verify the membership belongs to this user
    const { data: membership } = await supabase
      .from('org_members')
      .select('id, org_id, role, staff_member_id, status')
      .eq('id', membershipId)
      .eq('user_id', user.id)
      .single();

    if (!membership) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
    }

    if (membership.status !== 'pending') {
      return NextResponse.json({ error: 'Invitation already responded to' }, { status: 400 });
    }

    if (action === 'accept') {
      // Accept: update membership status
      await supabase.from('org_members').update({ status: 'accepted' }).eq('id', membershipId);

      // Update staff_members invite_status
      if (membership.staff_member_id) {
        await supabase.from('staff_members')
          .update({ invite_status: 'accepted' })
          .eq('id', membership.staff_member_id);
      }

      // Set this as the user's active org
      await supabase.from('profiles').update({
        org_id: membership.org_id,
        role: membership.role,
      }).eq('id', user.id);

      return NextResponse.json({ success: true, action: 'accepted', orgId: membership.org_id });
    } else {
      // Decline: delete the membership
      await supabase.from('org_members').delete().eq('id', membershipId);

      // Reset staff_member invite
      if (membership.staff_member_id) {
        await supabase.from('staff_members')
          .update({ user_id: null, invite_status: 'none' })
          .eq('id', membership.staff_member_id);
      }

      return NextResponse.json({ success: true, action: 'declined' });
    }
  } catch (err) {
    console.error('[Invite Respond] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
