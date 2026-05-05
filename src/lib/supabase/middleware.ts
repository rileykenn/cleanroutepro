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

  if (!user && !isPublicPath && !isApiPath && !isAuthPath) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (user && (request.nextUrl.pathname === '/login' || request.nextUrl.pathname === '/register')) {
    // Check role to determine where to redirect
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    const url = request.nextUrl.clone();
    if (profile?.role === 'staff') {
      url.pathname = '/dashboard/staff-view';
    } else {
      url.pathname = '/dashboard/schedule';
    }
    return NextResponse.redirect(url);
  }

  // Block staff from accessing admin-only pages
  if (user && request.nextUrl.pathname.startsWith('/dashboard/')) {
    const adminOnlyPaths = ['/dashboard/schedule', '/dashboard/templates', '/dashboard/settings', '/dashboard/staff'];
    const isAdminOnly = adminOnlyPaths.some(p => request.nextUrl.pathname === p || request.nextUrl.pathname.startsWith(p + '/'));

    if (isAdminOnly) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      if (profile?.role === 'staff') {
        const url = request.nextUrl.clone();
        url.pathname = '/dashboard/staff-view';
        return NextResponse.redirect(url);
      }
    }
  }

  return supabaseResponse;
}
