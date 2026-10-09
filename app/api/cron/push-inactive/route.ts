import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createBiginContact } from "@/lib/bigin";
import { generateInquirySummary } from "@/lib/claude";
import type { ConversationMessage } from "@/lib/claude";

export const dynamic = "force-dynamic";

// Vercel cron calls this route every 5 minutes.
// It finds conversations that started but went silent, and pushes them to Bigin
// with Sales_Inquiry = "No Communication yet" so the purchase team can follow up.

const SILENCE_MINUTES = 12;
const TABLE = "mw_whatsapp";

function getSupabase() {
  // Same env vars as lib/supabase.ts — the NEXT_PUBLIC_ ones were never set, so this cron crashed silently
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key);
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

  // Find conversations that:
  // - started (step > 0, customer sent at least one message)
  // - have been silent for 5+ minutes
  // - have never been pushed to Bigin
  const { data: stale, error } = await supabase
    .from(TABLE)
    .select("*")
    .gt("step", 0)
    .lt("last_message_at", cutoff)
    .is("bigin_pushed_at", null)
    .limit(50);

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
      const st = conv.sell_timeline ?? "";
      if (st.includes("cash"))        salesInquiry = "Cash Deal";
      else if (st.includes("consignment")) salesInquiry = "Consignment";
      else if (st.includes("not_sure"))    salesInquiry = "Not Sure - Need Advise";
      else if (st.includes("home_visit"))  salesInquiry = "Home Visit Inquiry";
      else if (st.includes("trade_in"))    salesInquiry = "Trade-in Inquiry";
      else if (st.includes("price_offer")) salesInquiry = "Price Offer Inquiry";

      const history: ConversationMessage[] = Array.isArray(conv.messages) ? conv.messages : [];
      const inquirySummary = await generateInquirySummary(history, {
        name: conv.name, make: conv.make, model: conv.model, year: conv.year,
        mileage: conv.mileage, specs: conv.specs, loan: conv.loan,
        sell_timeline: conv.sell_timeline,
        owner_status: conv.owner_status,
        car_conditions: conv.car_conditions,
      }).catch(() => "");

      await createBiginContact({
        ...conv,
        phone_number: conv.phone_number || conv.phone,
        sales_inquiry: salesInquiry,
        // If a date + time were captured, the customer did book — don't push as "not booked"
        inspection_booked: !!(conv.appointment_date && conv.appointment_time),
        inquiry_summary: inquirySummary,
        owner_status: conv.owner_status,
        car_conditions: conv.car_conditions,
      } as any);

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
