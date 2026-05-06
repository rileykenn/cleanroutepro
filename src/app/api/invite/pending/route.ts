import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const serverSupabase = await createServerClient();
    const { data: { user } } = await serverSupabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Use service role to bypass RLS — user can't read orgs they haven't joined yet
    const adminSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { data: memberships } = await adminSupabase
      .from('org_members')
      .select('id, org_id, role, status')
      .eq('user_id', user.id)
      .eq('status', 'pending');

    if (!memberships || memberships.length === 0) {
      return NextResponse.json({ invites: [] });
    }

    // Fetch org names
    const orgIds = memberships.map(m => m.org_id);
    const { data: orgs } = await adminSupabase
      .from('organizations')
      .select('id, name')
      .in('id', orgIds);

    const orgMap = new Map((orgs || []).map(o => [o.id, o.name]));

    const invites = memberships.map(m => ({
      id: m.id,
      org_id: m.org_id,
      role: m.role,
      org_name: orgMap.get(m.org_id) || 'Unknown',
    }));

    return NextResponse.json({ invites });
  } catch (err) {
    console.error('[Pending Invites] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
