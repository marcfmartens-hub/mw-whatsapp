import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { authClient } from "@/lib/supabaseAuth";
import { hashPassword, createToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { access_token, password } = await req.json();
  if (!access_token) return NextResponse.json({ error: "This reset link is invalid. Request a new one." }, { status: 400 });
  if (!password || String(password).length < 6) return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });

  const { data, error } = await authClient().auth.getUser(access_token);
  const email = data?.user?.email?.toLowerCase();
  if (error || !email) return NextResponse.json({ error: "This reset link has expired. Request a new one." }, { status: 400 });

  const { data: user } = await supabase
    .from("mw_monitor_users")
    .select("username, role")
    .ilike("email", email)
    .maybeSingle();
  if (!user || user.role !== "super_admin") {
    return NextResponse.json({ error: "Only the super admin can reset a password this way." }, { status: 403 });
  }

  const { error: upErr } = await supabase
    .from("mw_monitor_users")
    .update({ password_hash: hashPassword(password), password_plain: password })
    .eq("username", user.username);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });

  // Signed straight in after the reset
  const res = NextResponse.json({ ok: true, username: user.username });
  res.cookies.set("mw_session", createToken(user.username), {
    httpOnly: true, secure: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 7, path: "/",
  });
  return res;
}
