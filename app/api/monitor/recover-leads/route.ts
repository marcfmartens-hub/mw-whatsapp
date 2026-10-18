import { NextRequest, NextResponse } from "next/server";
import { sessionUser } from "@/lib/monitorRole";
import { pushInactive } from "@/lib/inactive-leads";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function POST(req: NextRequest) {
  const user = await sessionUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "super_admin") return NextResponse.json({ error: "Super Admin only" }, { status: 403 });
  if (req.headers.get("origin") !== req.nextUrl.origin)
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  if (process.env.VERCEL_ENV !== "production")
    return NextResponse.json({ error: "Recovery is production only" }, { status: 409 });
  try { return NextResponse.json(await pushInactive(true)); }
  catch (e) { console.error("[recovery] failed", e); return NextResponse.json({ error: "Lead recovery failed; see server logs" }, { status: 500 }); }
}
