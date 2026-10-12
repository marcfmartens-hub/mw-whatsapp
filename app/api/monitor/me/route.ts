import { NextRequest, NextResponse } from "next/server";
import { sessionUser } from "@/lib/monitorRole";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const me = await sessionUser(req);
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(me);
}
