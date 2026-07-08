import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { createBiginContact } from "@/lib/bigin";
import type { Conversation } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const TEN_MINUTES_AGO = () => new Date(Date.now() - 10 * 60 * 1000).toISOString();

export async function GET(req: NextRequest) {
  // Protect the cron endpoint — Vercel sets this header automatically for cron jobs
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: stale, error } = await supabase
    .from("mw_whatsapp")
    .select("*")
    .lt("last_message_at", TEN_MINUTES_AGO())
    .is("bigin_pushed_at", null)
    .gt("step", 0);

  if (error) {
    console.error("[cron] query error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!stale || stale.length === 0) {
    return NextResponse.json({ pushed: 0 });
  }

  let pushed = 0;
  for (const conv of stale as Conversation[]) {
    try {
      await createBiginContact(conv);
      await supabase
        .from("mw_whatsapp")
        .update({ bigin_pushed_at: new Date().toISOString() })
        .eq("phone", conv.phone);
      pushed++;
    } catch (e) {
      console.error(`[cron] failed to push ${conv.phone}:`, e);
    }
  }

  console.log(`[cron] pushed ${pushed} inactive conversations to Bigin`);
  return NextResponse.json({ pushed });
}
