import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendWhatsAppMessage } from "@/lib/meta";

export const dynamic = "force-dynamic";

const NUDGE_AFTER_MS = 60 * 1000;       // 1 minute
const CLOSING_STEP   = 6;

export async function GET(req: NextRequest) {
  // Vercel cron passes this header — reject other callers
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - NUDGE_AFTER_MS).toISOString();

  // Find conversations that are mid-flow, haven't been updated in 1 min,
  // and haven't already been nudged (nudged_at is null or older than cutoff)
  const { data, error } = await supabase
    .from("mw_whatsapp")
    .select("phone, step, name, nudged_at")
    .gt("step", 0)
    .lt("step", CLOSING_STEP)
    .lt("updated_at", cutoff)
    .or(`nudged_at.is.null,nudged_at.lt.${cutoff}`);

  if (error) {
    console.error("[nudge] query error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  for (const conv of data ?? []) {
    const name = conv.name ? ` ${conv.name}` : "";
    const msg = `Hey${name}, still there? 😊`;
    try {
      await sendWhatsAppMessage(conv.phone, msg);
      await supabase
        .from("mw_whatsapp")
        .update({ nudged_at: new Date().toISOString() })
        .eq("phone", conv.phone);
      console.log(`[nudge] sent to ${conv.phone}`);
    } catch (e) {
      console.error(`[nudge] failed for ${conv.phone}:`, e);
    }
  }

  return NextResponse.json({ nudged: data?.length ?? 0 });
}
