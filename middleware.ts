import { NextRequest, NextResponse } from "next/server";

const SECRET = process.env.MONITOR_SECRET ?? process.env.CRON_SECRET ?? "mw-monitor-fallback";

async function verifyToken(token: string): Promise<boolean> {
  try {
    // token is base64url of `${jsonPayload}.${hexSig}`
    const decoded = Buffer.from(token, "base64url").toString();
    const dotIdx = decoded.lastIndexOf(".");
    if (dotIdx === -1) return false;
    const payload = decoded.slice(0, dotIdx);
    const sigHex  = decoded.slice(dotIdx + 1);

    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );

    // hex → Uint8Array
    const sigBytes = new Uint8Array(
      (sigHex.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)),
    );

    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(payload));
    if (!valid) return false;

    const { ts } = JSON.parse(payload) as { username: string; ts: number };
    return Date.now() - ts < 7 * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (!pathname.startsWith("/monitor")) return NextResponse.next();
  if (pathname.startsWith("/monitor/login")) return NextResponse.next();
  if (pathname.startsWith("/api/monitor/")) return NextResponse.next();

  const token = req.cookies.get("mw_session")?.value;
  if (token && await verifyToken(token)) return NextResponse.next();

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/monitor/login";
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/monitor/:path*", "/api/monitor/:path*"],
};
