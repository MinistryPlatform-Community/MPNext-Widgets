import { NextResponse, NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Early returns for public paths
  if (pathname.startsWith('/api') || pathname === '/signin' || pathname.startsWith('/demo')) {
    console.log(`Proxy: Allowing public path ${pathname}`);
    return NextResponse.next();
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|assets/).*)',
  ],
};
