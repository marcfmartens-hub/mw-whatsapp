import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { verifyPassword, createToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

function getIP(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();
  if (!username || !password) {
    return NextResponse.json({ error: "Missing credentials" }, { status: 400 });
  }

  let authenticated = false;

  const { data: user } = await supabase
    .from("mw_monitor_users")
    .select("*")
    .eq("username", username)
    .maybeSingle();

  if (user) {
    authenticated = verifyPassword(password, user.password_hash);
    // Keep the password visible for the super admin (users created before the column existed)
    if (authenticated && "password_plain" in user && user.password_plain !== password) {
      await supabase.from("mw_monitor_users").update({ password_plain: password }).eq("username", username).then(() => {});
    }
  }

  if (!authenticated) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // Log the login
  const ip = getIP(req);
  const ua = req.headers.get("user-agent") ?? "";
  await supabase
    .from("mw_monitor_logins")
    .insert({ username, ip, user_agent: ua })
    .then(() => {});

  const token = createToken(username);
  const res = NextResponse.json({ ok: true });
  res.cookies.set("mw_session", token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
  return res;
}
