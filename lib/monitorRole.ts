import { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { verifyToken } from "@/lib/auth";

export type MonitorRole = "super_admin" | "call_center";

// Marc is always super admin, even before the role column exists.
const OWNER = "marc";

export async function roleOf(username: string): Promise<MonitorRole> {
  if (username.toLowerCase() === OWNER) return "super_admin";
  const { data, error } = await supabase
    .from("mw_monitor_users")
    .select("role")
    .eq("username", username)
    .maybeSingle();
  if (error || !data) return "call_center";
  return data.role === "super_admin" ? "super_admin" : "call_center";
}

export async function sessionUser(req: NextRequest): Promise<{ username: string; role: MonitorRole } | null> {
  const token = req.cookies.get("mw_session")?.value;
  const username = token ? verifyToken(token) : null;
  if (!username) return null;
  return { username, role: await roleOf(username) };
}
