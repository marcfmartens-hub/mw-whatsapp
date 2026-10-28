import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyToken } from "@/lib/auth";
import { roleOf } from "@/lib/monitorRole";
import V3TestPanel from "./panel";
export const dynamic = "force-dynamic";
export default async function V3TestPage() {
  const username = verifyToken(cookies().get("mw_session")?.value ?? "");
  if (!username) redirect("/monitor/login");
  if (await roleOf(username) !== "super_admin") redirect("/monitor");
  return <V3TestPanel />;
}
