import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { authClient } from "@/lib/supabaseAuth";

export const dynamic = "force-dynamic";

// Self-service password reset is super-admin only; everyone else asks a super admin.
export async function POST(req: NextRequest) {
  const { email } = await req.json();
  const e = String(email ?? "").trim().toLowerCase();
  if (!e) return NextResponse.json({ error: "Enter your email address." }, { status: 400 });

  const { data: user } = await supabase
    .from("mw_monitor_users")
    .select("username, role")
    .ilike("email", e)
    .maybeSingle();

  if (!user || user.role !== "super_admin") {
    return NextResponse.json({ contactAdmin: true });
  }

  const { error } = await authClient().auth.signInWithOtp({
    email: e,
    options: { emailRedirectTo: `${req.nextUrl.origin}/monitor/login/reset`, shouldCreateUser: true },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
