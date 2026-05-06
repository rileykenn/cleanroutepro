import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const publicPaths = ['/', '/login', '/register', '/forgot-password'];
  const isPublicPath = publicPaths.some(
    (path) => request.nextUrl.pathname === path
  );
  const isApiPath = request.nextUrl.pathname.startsWith('/api/');
  const isAuthPath = request.nextUrl.pathname.startsWith('/auth/');

  // Not logged in — redirect to login for protected paths
  if (!user && !isPublicPath && !isApiPath && !isAuthPath) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Logged in user on login/register page — redirect to dashboard
  if (user && (request.nextUrl.pathname === '/login' || request.nextUrl.pathname === '/register')) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  // Logged in, on dashboard — check profile state
  if (user && request.nextUrl.pathname.startsWith('/dashboard')) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, org_id')
      .eq('id', user.id)
      .single();

    // No org — only allow the main dashboard page (shows no-org state)
    if (!profile?.org_id) {
      if (request.nextUrl.pathname !== '/dashboard') {
        const url = request.nextUrl.clone();
        url.pathname = '/dashboard';
        return NextResponse.redirect(url);
      }
      return supabaseResponse;
    }

    // Staff — block admin-only pages
    const adminOnlyPaths = ['/dashboard/schedule', '/dashboard/templates', '/dashboard/settings', '/dashboard/staff'];
    const isAdminOnly = adminOnlyPaths.some(p => request.nextUrl.pathname === p || request.nextUrl.pathname.startsWith(p + '/'));

    if (profile.role === 'staff' && isAdminOnly) {
      const url = request.nextUrl.clone();
      url.pathname = '/dashboard/staff-view';
      return NextResponse.redirect(url);
    }

    // Admin on /dashboard should go to schedule
    if (profile.role === 'admin' && request.nextUrl.pathname === '/dashboard') {
      const url = request.nextUrl.clone();
      url.pathname = '/dashboard/schedule';
      return NextResponse.redirect(url);
    }

    // Staff on /dashboard should go to staff-view
    if (profile.role === 'staff' && request.nextUrl.pathname === '/dashboard') {
      const url = request.nextUrl.clone();
      url.pathname = '/dashboard/staff-view';
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
