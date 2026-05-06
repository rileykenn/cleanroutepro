import { createClient as createServerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { orgId } = await request.json();
    if (!orgId) return NextResponse.json({ error: 'Missing orgId' }, { status: 400 });

    // Verify user is a member of this org
    const { data: membership } = await supabase
      .from('org_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('org_id', orgId)
      .single();

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this organisation' }, { status: 403 });
    }

    // Update active org and role in profiles
    const { error } = await supabase
      .from('profiles')
      .update({ org_id: orgId, role: membership.role })
      .eq('id', user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, role: membership.role });
  } catch (err) {
    console.error('[Switch Org] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
