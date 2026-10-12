import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { hashPassword } from "@/lib/auth";
import { sessionUser } from "@/lib/monitorRole";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const ROLES = ["super_admin", "call_center"];

// Settings (users + login history) is super-admin only.
async function guard(req: NextRequest) {
  const me = await sessionUser(req);
  if (!me) return { res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (me.role !== "super_admin") return { res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { me };
}

export async function GET(req: NextRequest) {
  const g = await guard(req);
  if (g.res) return g.res;

  const [{ data: logins }, usersRes] = await Promise.all([
    supabase.from("mw_monitor_logins").select("*").order("logged_in_at", { ascending: false }).limit(50),
    supabase.from("mw_monitor_users").select("*").order("created_at", { ascending: true }),
  ]);

  let users: any[] = usersRes.data ?? [];
  const needsMigration = users.length > 0 && !("email" in users[0]);

  return NextResponse.json({
    logins: logins ?? [],
    needsMigration,
    users: users.map((u) => ({
      username: u.username,
      role: u.role === "super_admin" ? "super_admin" : "call_center",
      password: u.password_plain ?? null,
      email: u.email ?? null,
      created_at: u.created_at,
    })),
  });
}

export async function POST(req: NextRequest) {
  const g = await guard(req);
  if (g.res) return g.res;

  const { username, password, role, email } = await req.json();
  if (!username?.trim() || !password?.trim()) {
    return NextResponse.json({ error: "Username and password required" }, { status: 400 });
  }
  const r = ROLES.includes(role) ? role : "call_center";

  const { error } = await supabase.from("mw_monitor_users").insert({
    username: username.trim(),
    password_hash: hashPassword(password),
    password_plain: password,
    role: r,
    ...(email?.trim() ? { email: email.trim().toLowerCase() } : {}),
  });

  if (error) {
    const msg = error.code === "23505" ? "Username already exists"
      : error.code === "PGRST204" ? "Database needs the role/password columns first (run the SQL)."
      : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

// Change role and/or password
export async function PATCH(req: NextRequest) {
  const g = await guard(req);
  if (g.res) return g.res;

  const { username, password, role, email } = await req.json();
  if (!username) return NextResponse.json({ error: "Username required" }, { status: 400 });
  const upd: Record<string, string | null> = {};
  if (typeof email === "string") upd.email = email.trim() ? email.trim().toLowerCase() : null;
  if (password?.trim()) { upd.password_hash = hashPassword(password); upd.password_plain = password; }
  if (role && ROLES.includes(role)) {
    if (username === g.me!.username && role !== "super_admin") {
      return NextResponse.json({ error: "You can't remove your own super admin role" }, { status: 400 });
    }
    upd.role = role;
  }
  if (!Object.keys(upd).length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const { error } = await supabase.from("mw_monitor_users").update(upd).eq("username", username);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const g = await guard(req);
  if (g.res) return g.res;

  const { username } = await req.json();
  if (!username) return NextResponse.json({ error: "Username required" }, { status: 400 });
  if (username === g.me!.username) {
    return NextResponse.json({ error: "You can't delete this user" }, { status: 400 });
  }
  const { data: target } = await supabase.from("mw_monitor_users").select("role").eq("username", username).maybeSingle();
  if (target?.role === "super_admin") {
    return NextResponse.json({ error: "Super admins can't be deleted. Make them call center first." }, { status: 400 });
  }
  const { error } = await supabase.from("mw_monitor_users").delete().eq("username", username);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
