import { NextResponse, NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Early returns for public paths
  if (pathname.startsWith('/api') || pathname === '/signin' || pathname.startsWith('/demo')) {
    console.log(`Proxy: Allowing public path ${pathname}`);
    return NextResponse.next();
  }

  try {
    const sessionCookie = getSessionCookie(request);
    if (!sessionCookie) {
      return NextResponse.redirect(new URL('/signin', request.url));
    }
    return NextResponse.next();
  } catch (error) {
    console.error('Proxy: Error checking session:', error);
    return NextResponse.redirect(new URL('/signin', request.url));
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|assets/).*)',
  ],
};
