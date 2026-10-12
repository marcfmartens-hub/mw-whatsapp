import { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { verifyToken } from "@/lib/auth";

export type MonitorRole = "super_admin" | "call_center";

export async function roleOf(username: string): Promise<MonitorRole> {
  const { data: rows, error } = await supabase
    .from("mw_monitor_users")
    .select("username, role, created_at")
    .order("created_at", { ascending: true });
  if (error || !rows?.length) return "call_center";

  const me = rows.find((r) => r.username === username);
  if (!me) return "call_center";
  if (me.role === "super_admin") return "super_admin";

  // Safety net: if nobody is super admin, the first (oldest) user becomes super admin.
  if (!rows.some((r) => r.role === "super_admin") && rows[0].username === username) {
    await supabase.from("mw_monitor_users").update({ role: "super_admin" }).eq("username", username);
    return "super_admin";
  }
  return "call_center";
}

export async function sessionUser(req: NextRequest): Promise<{ username: string; role: MonitorRole } | null> {
  const token = req.cookies.get("mw_session")?.value;
  const username = token ? verifyToken(token) : null;
  if (!username) return null;
  return { username, role: await roleOf(username) };
}
