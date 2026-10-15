import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createBiginContact, moveLeadToCallBack } from "@/lib/bigin";
import { pickDefaultTime } from "@/lib/slots";
import { sendWhatsAppMessage } from "@/lib/meta";
import { generateInquirySummary } from "@/lib/claude";
import type { ConversationMessage } from "@/lib/claude";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// Vercel cron calls this route every 5 minutes.
// It finds conversations that started but went silent, and pushes them to Bigin
// with Sales_Inquiry = "No Communication yet" so the purchase team can follow up.

const SILENCE_MINUTES = 12;
const TABLE = "mw_whatsapp";

function getSupabase() {
  // Same env vars as lib/supabase.ts — the NEXT_PUBLIC_ ones were never set, so this cron crashed silently
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  // no-store: Next.js was caching these reads, so new silent chats were never seen
  return createClient(url, key, { global: { headers: process.env.KAYA_IMPROVE_SECRET ? { "x-kaya-improve-secret": process.env.KAYA_IMPROVE_SECRET } : {}, fetch: (i: RequestInfo | URL, init?: RequestInit) => fetch(i, { ...init, cache: "no-store" }) } });
}

export async function GET(req: NextRequest) {
  // Security: Vercel signs cron requests with CRON_SECRET
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  const cutoff = new Date(Date.now() - SILENCE_MINUTES * 60 * 1000).toISOString();

  // Silent for 12+ min (but active in the last 3 days), and either never pushed
  // or has new messages since the last push → push / update in Bigin.
  const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const { data: candidates, error } = await supabase
    .from(TABLE)
    .select("*")
    .gt("step", 0)
    .lt("last_message_at", cutoff)
    .gt("last_message_at", since)
    .limit(200);
  const stale = (candidates ?? []).filter((c: any) =>
    !c.bigin_pushed_at || new Date(c.last_message_at) > new Date(c.bigin_pushed_at)
  ).slice(0, 50);

  if (error) {
    console.error("[cron/timeout] Supabase query error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!stale || stale.length === 0) {
    return NextResponse.json({ pushed: 0 });
  }

  let pushed = 0;
  for (const conv of stale) {
    try {
      // Determine Sales_Inquiry label based on what we know
      let salesInquiry = "No Communication yet";
      const notesC = String(conv.car_conditions ?? "");
      const lastReply = [...(Array.isArray(conv.messages) ? conv.messages : [])].reverse()
        .find((m: any) => m.role === "assistant")?.content ?? "";
      // Existing booked leads get a linked task for changes and inquiries. Do not
      // push another lead when the conversation becomes inactive afterward.
      if (/\b(CANCELLED:|RESCHEDULE REQUESTED:)/.test(notesC)
          || /Your appointment inquiry is recorded\./i.test(lastReply)) continue;
      const st = conv.sell_timeline ?? "";
      if (st.includes("cash"))        salesInquiry = "Cash Deal";
      else if (st.includes("consignment")) salesInquiry = "Consignment";
      else if (st.includes("not_sure"))    salesInquiry = "Not Sure - Need Advise";
      else if (st.includes("home_visit"))  salesInquiry = "Home Visit Inquiry";
      else if (st.includes("trade_in"))    salesInquiry = "Trade-in Inquiry";
      else if (st.includes("price_offer")) salesInquiry = "Price Offer Inquiry";
      if (notesC.includes("Trade-in:")) salesInquiry = "Trade-in Inquiry";
      else if (notesC.includes("BUYER:")) salesInquiry = "Other";

      const history: ConversationMessage[] = Array.isArray(conv.messages) ? conv.messages : [];
      const inquirySummary = await generateInquirySummary(history, {
        name: conv.name, make: conv.make, model: conv.model, year: conv.year,
        mileage: conv.mileage, specs: conv.specs, loan: conv.loan,
        sell_timeline: conv.sell_timeline,
        owner_status: conv.owner_status,
        car_conditions: conv.car_conditions,
      }).catch(() => "");

      // Only after Kaya has asked once for an exact time without getting an answer:
      // choose a :15 slot, tell the customer, and then save it as a real booking.
      const lastAssistant = [...history].reverse().find(m => m.role === "assistant")?.content ?? "";
      const notReady = notesC.includes("NOT READY YET");
      const date = String(conv.appointment_date ?? "");
      const today = new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
      const canDefault = !notReady && !conv.appointment_time && /^\d{4}-\d{2}-\d{2}$/.test(date)
        && date >= today && new Date(`${date}T12:00:00Z`).getUTCDay() !== 0
        && /what exact time would you prefer on that day\?/i.test(lastAssistant);
      let defaulted = false;
      if (canDefault) {
        const previous = [...history].reverse().find(m => m.role === "user")?.content ?? "";
        const part = /\b(morning|afternoon|evening)\b/i.exec(previous)?.[1]?.toLowerCase() as "morning" | "afternoon" | "evening" | undefined;
        const slot = await pickDefaultTime(date, conv.phone, part);
        const nowDubai = new Date(Date.now() + 4 * 3600e3);
        const slotMinutes = +slot.slice(0, 2) * 60 + +slot.slice(3);
        if (date === today && slotMinutes < nowDubai.getUTCHours() * 60 + nowDubai.getUTCMinutes() + 60) {
          console.warn("[cron/timeout] no future slot for", conv.phone);
        } else {
        const day = new Date(`${date}T12:00:00Z`);
        const hour = +slot.slice(0, 2);
        const when = `${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day.getUTCDay()]} ${day.getUTCDate()} ${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][day.getUTCMonth()]}`;
        const reply = `I've booked your inspection for ${when} at ${hour % 12 || 12}:${slot.slice(3)} ${hour < 12 ? "AM" : "PM"}. Our call centre will confirm the exact timing with you on the morning of the booking.\n\n📍 Mister Wheelz Car Buyers\nUmm Suqeim Branch, Al Quoz 4, Dubai\nhttps://maps.app.goo.gl/nv6Yy7uKqVCnkcVx6\nMon–Sat 10 AM–7 PM (Friday from 12 PM); closed Sunday\nCustomer service: 058 582 5543`;
        await sendWhatsAppMessage(conv.phone, reply);
        conv.appointment_time = slot;
        conv.step = 8;
        conv.messages = [...history, { role: "assistant", content: reply }].slice(-40);
        const { error: saveError } = await supabase.from(TABLE).update({ appointment_time: slot, step: 8, messages: conv.messages }).eq("phone", conv.phone);
        if (saveError) throw saveError;
        defaulted = true;
        }
      }
      const ok = await createBiginContact({
        ...conv,
        phone_number: conv.phone_number || conv.phone,
        sales_inquiry: salesInquiry,
        // If a date + time were captured, the customer did book — don't push as "not booked"
        inspection_booked: !!(conv.appointment_date && conv.appointment_time && (defaulted || history.some(m => m.role === "assistant" && /you'?re booked for/i.test(m.content)))),
        inquiry_summary: [notReady ? `NOT READY YET — ${notesC.includes("Declined personal call") ? "customer declined a call; do not call." : notesC.includes("Accepted personal call") ? "customer requested a call." : "call preference pending."}` : "", inquirySummary].filter(Boolean).join("\n\n"),
        owner_status: conv.owner_status,
        car_conditions: conv.car_conditions,
      } as any);

      if (!ok) throw new Error("Bigin push failed");
      if (notReady) await moveLeadToCallBack(conv.phone);
      await supabase
        .from(TABLE)
        .update({ bigin_pushed_at: new Date().toISOString() })
        .eq("phone", conv.phone);

      console.log(`[cron/timeout] pushed ${conv.phone} → ${salesInquiry}`);
      pushed++;
    } catch (e) {
      console.error(`[cron/timeout] failed to push ${conv.phone}:`, e);
    }
  }

  return NextResponse.json({ pushed, total: stale.length });
}
