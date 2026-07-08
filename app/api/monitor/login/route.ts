import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { hashPassword, verifyPassword, createToken } from "@/lib/auth";

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

  // Try Supabase users table
  const { data: user, error } = await supabase
    .from("mw_monitor_users")
    .select("*")
    .eq("username", username)
    .maybeSingle();

  if (error?.code === "42P01") {
    // Table doesn't exist yet — bootstrap: accept marc/0492342753 and create tables implicitly
    if (username === "marc" && password === "0492342753") {
      authenticated = true;
    }
  } else if (!user) {
    // No such user — if it's the bootstrap admin and table is empty, auto-create
    if (username === "marc" && password === "0492342753") {
      const { count } = await supabase
        .from("mw_monitor_users")
        .select("*", { count: "exact", head: true });
      if ((count ?? 0) === 0) {
        await supabase
          .from("mw_monitor_users")
          .insert({ username: "marc", password_hash: hashPassword("0492342753") });
        authenticated = true;
      }
    }
  } else {
    authenticated = verifyPassword(password, user.password_hash);
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
