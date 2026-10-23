import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendWhatsAppMessage } from "@/lib/meta";
import { flowState } from "@/lib/conversation-state";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// Marc: a customer who sent only their first message and went quiet gets ONE nudge after 5 minutes.
const NUDGE_TEXT = "Hello. Please let us know how we can help you, or if you need a call back from our team.";
const AFTER_MIN = 5;
const WINDOW_MIN = 60; // never nudge old chats

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const { data, error } = await supabase
    .from("mw_whatsapp")
    .select("phone, messages, last_message_at, step, flow_state")
    .lt("last_message_at", new Date(now - AFTER_MIN * 60e3).toISOString())
    .gt("last_message_at", new Date(now - WINDOW_MIN * 60e3).toISOString())
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let sent = 0;
  for (const c of data ?? []) {
    if (["closed", "customer_will_contact", "team_accepted", "booked", "default_pending"].includes(flowState(c).status)) continue;
    const msgs: { role: string; content: string }[] = Array.isArray(c.messages) ? c.messages : [];
    if (String(c.phone).startsWith("971599900")) continue; // test numbers
    const userCount = msgs.filter((m) => m.role === "user").length;
    const last = msgs[msgs.length - 1];
    if (userCount !== 1 || !last || last.role !== "assistant") continue;
    if (msgs.some((m) => m.role === "assistant" && m.content === NUDGE_TEXT)) continue;

    // Mark first (so an overlapping run can't send it twice), keep last_message_at as is
    const { error: upErr } = await supabase
      .from("mw_whatsapp")
      .update({ messages: [...msgs, { role: "assistant", content: NUDGE_TEXT }].slice(-40) })
      .eq("phone", c.phone)
      .eq("last_message_at", c.last_message_at);
    if (upErr) continue;
    try {
      await sendWhatsAppMessage(c.phone, NUDGE_TEXT);
      sent++;
      console.log(`[cron/nudge] nudged ${c.phone}`);
    } catch (e) {
      console.error(`[cron/nudge] send failed for ${c.phone}:`, e);
    }
  }
  return NextResponse.json({ sent });
}
