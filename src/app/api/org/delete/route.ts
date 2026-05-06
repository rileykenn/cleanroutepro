import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const serverSupabase = await createServerClient();
    const { data: { user } } = await serverSupabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { orgId, confirmText } = await request.json();
    if (!orgId) return NextResponse.json({ error: 'Missing orgId' }, { status: 400 });

    // Verify user is admin of this org
    const { data: membership } = await serverSupabase
      .from('org_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('org_id', orgId)
      .eq('status', 'accepted')
      .single();

    if (!membership || membership.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can delete organisations' }, { status: 403 });
    }

    // Get org name for confirmation
    const adminSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { data: org } = await adminSupabase
      .from('organizations')
      .select('name')
      .eq('id', orgId)
      .single();

    if (!org) return NextResponse.json({ error: 'Organisation not found' }, { status: 404 });

    // Verify confirmation text
    if (confirmText !== 'delete my organisation') {
      return NextResponse.json({ error: 'Invalid confirmation text' }, { status: 400 });
    }

    // Cascade delete: remove all org data (use service role to bypass RLS)
    // Order matters due to foreign key constraints
    await adminSupabase.from('checklist_completions').delete().eq('org_id', orgId);
    await adminSupabase.from('checklist_templates').delete().eq('org_id', orgId);
    await adminSupabase.from('schedule_jobs').delete().eq('org_id', orgId);
    await adminSupabase.from('schedules').delete().eq('org_id', orgId);
    await adminSupabase.from('clients').delete().eq('org_id', orgId);
    await adminSupabase.from('staff_members').delete().eq('org_id', orgId);
    await adminSupabase.from('teams').delete().eq('org_id', orgId);
    
    // Remove all memberships
    await adminSupabase.from('org_members').delete().eq('org_id', orgId);
    
    // Null out org_id for any profiles pointing to this org
    await adminSupabase.from('profiles').update({ org_id: null }).eq('org_id', orgId);
    
    // Delete the org itself
    await adminSupabase.from('organizations').delete().eq('id', orgId);

    // If this was the user's active org, clear it
    const { data: profile } = await adminSupabase
      .from('profiles')
      .select('org_id')
      .eq('id', user.id)
      .single();

    if (profile && profile.org_id === null) {
      // User no longer has an org — check if they have other memberships
      const { data: otherMemberships } = await adminSupabase
        .from('org_members')
        .select('org_id, role')
        .eq('user_id', user.id)
        .eq('status', 'accepted')
        .limit(1);

      if (otherMemberships && otherMemberships.length > 0) {
        // Switch to another org
        await adminSupabase.from('profiles').update({
          org_id: otherMemberships[0].org_id,
          role: otherMemberships[0].role,
        }).eq('id', user.id);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Delete Org] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
