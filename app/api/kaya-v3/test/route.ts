import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { roleOf } from "@/lib/monitorRole";
import { type Memory } from "@/lib/kaya-v3/engine";
import { aiV3Turn } from "@/lib/kaya-v3/ai-engine";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function POST(req: NextRequest) {
  const username = verifyToken(cookies().get("mw_session")?.value ?? "");
  if (!username || await roleOf(username) !== "super_admin") return NextResponse.json({error:"Unauthorized"},{status:401});
  try {
    const body = await req.json();
    if (typeof body.message !== "string" || !body.message.trim() || body.message.length > 2000) return NextResponse.json({error:"Enter a message (up to 2000 characters)."},{status:400});
    const supplied = body.memory;
    const memory: Memory = supplied && Array.isArray(supplied.messages) && supplied.messages.length <= 100
      ? { ...supplied, messages: supplied.messages.filter((m:unknown) => !!m && typeof m === "object" && ["user","assistant"].includes((m as {role:string}).role) && typeof (m as {content:string}).content === "string").slice(-100) }
      : {messages:[]};
    const result = await aiV3Turn(memory, body.message);
    return NextResponse.json({ ...result, engine:result.engine, sideEffects:false });
  } catch {
    return NextResponse.json({error:"Test engine error"},{status:500});
  }
}
