import { NextRequest, NextResponse } from "next/server";
import { sessionUser } from "@/lib/monitorRole";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  if (!await sessionUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const token = process.env.META_ACCESS_TOKEN;
  const phone = process.env.META_PHONE_NUMBER_ID;
  const respond = (whatsapp: string) => NextResponse.json({ whatsapp, checked_at: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  if (!token || !phone) return respond("configuration_missing");
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(phone)}?fields=id`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(8000),
    });
    const body = await res.json().catch(() => null);
    if (res.status === 401 || body?.error?.code === 190) return respond("authentication_required");
    return respond(res.ok && body?.id ? "verified" : "unavailable");
  } catch { return respond("unavailable"); }
}
