import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only protect /monitor routes; let login page and monitor API through
  if (!pathname.startsWith("/monitor")) return NextResponse.next();
  if (pathname.startsWith("/monitor/login")) return NextResponse.next();
  if (pathname.startsWith("/api/monitor/")) return NextResponse.next();

  const token = req.cookies.get("mw_session")?.value;
  if (token && verifyToken(token)) return NextResponse.next();

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/monitor/login";
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/monitor/:path*", "/api/monitor/:path*"],
};
