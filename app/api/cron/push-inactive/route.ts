import { NextRequest, NextResponse } from "next/server";
import { pushInactive } from "@/lib/inactive-leads";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 300;
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await pushInactive()); }
  catch (e) { console.error("[cron/timeout] failed", e); return NextResponse.json({ error: "Lead forwarding failed" }, { status: 500 }); }
}
