import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { hashPassword } from "@/lib/auth";
import { verifyToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

function authed(req: NextRequest): boolean {
  const token = req.cookies.get("mw_session")?.value;
  return !!token && !!verifyToken(token);
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [{ data: logins }, { data: users }] = await Promise.all([
    supabase
      .from("mw_monitor_logins")
      .select("*")
      .order("logged_in_at", { ascending: false })
      .limit(50),
    supabase
      .from("mw_monitor_users")
      .select("username, created_at")
      .order("created_at", { ascending: true }),
  ]);

  return NextResponse.json({ logins: logins ?? [], users: users ?? [] });
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { username, password } = await req.json();
  if (!username?.trim() || !password?.trim()) {
    return NextResponse.json({ error: "Username and password required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("mw_monitor_users")
    .insert({ username: username.trim(), password_hash: hashPassword(password) });

  if (error) {
    const msg = error.code === "23505" ? "Username already exists" : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
