import { NextRequest, NextResponse } from "next/server";
import { resetConversation } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { phone } = await req.json();
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });
  await resetConversation(phone);
  return NextResponse.json({ ok: true });
}
