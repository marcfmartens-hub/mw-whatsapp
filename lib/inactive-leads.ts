import { createClient } from "@supabase/supabase-js";
import { createBiginContact, createChangeTask, moveLeadToCallBack } from "@/lib/bigin";
import { sendWhatsAppMessage } from "@/lib/meta";
import { generateInquirySummary } from "@/lib/claude";
import type { ConversationMessage } from "@/lib/claude";
import { flowState, inspectionBooked, STATUS_LABELS } from "./conversation-state";
import { chooseDefault } from "./conversation-turn";

// Vercel cron runs every 15 minutes.
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

// Also called by the authenticated monitor recovery action; no customer messages
// are sent when recoveryOnly is true.
export async function pushInactive(recoveryOnly = false) {
  const supabase = getSupabase();
  const cutoff = new Date(Date.now() - SILENCE_MINUTES * 60 * 1000).toISOString();

  // Silent for 12+ min (but active in the last 3 days), and either never pushed
  // or has new messages since the last push → push / update in Bigin.
  const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const { data: candidates, error } = await supabase
    .from(TABLE)
    .select("*")
    .lt("last_message_at", cutoff)
    .gt("last_message_at", since)
    .order("last_message_at", { ascending: true })
    .limit(200);
  // Recover inbound records left without timestamps by the previous handler.
  const legacy = await supabase.from(TABLE).select("*").is("last_message_at", null)
    .is("bigin_pushed_at", null).eq("step", 0).gt("created_at", since).lt("created_at", cutoff)
    .order("created_at", { ascending: true }).limit(50);
  if (legacy.error) throw legacy.error;
  const stale = [...(candidates ?? []), ...(legacy.data ?? [])].filter((c: any) =>
    /^\d{8,16}$/.test(String(c.phone)) &&
    (c.step > 0 || (Array.isArray(c.messages) && c.messages.some((m: any) => m.role === "user"))) &&
    (!c.bigin_pushed_at || new Date(c.last_message_at) > new Date(c.bigin_pushed_at))
  ).slice(0, 50);

  if (error) {
    console.error("[cron/timeout] Supabase query error:", error);
    throw error;
  }

  if (!stale || stale.length === 0) {
    return { pushed: 0, total: 0, failed: 0 };
  }

  let pushed = 0;
  let failed = 0;
  for (const conv of stale) {
    try {
      // Determine Sales_Inquiry label based on what we know
      let salesInquiry = "No Communication yet";
      const notesC = String(conv.car_conditions ?? "");
      const lastReply = [...(Array.isArray(conv.messages) ? conv.messages : [])].reverse()
        .find((m: any) => m.role === "assistant")?.content ?? "";
      // Existing booked leads get a linked task for changes and inquiries. Do not
      // push another lead when the conversation becomes inactive afterward.
      if (!conv.flow_state && (/\b(CANCELLED:|RESCHEDULE REQUESTED:)/.test(notesC)
          || /Your appointment inquiry is recorded\./i.test(lastReply))) continue;
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
      const inquirySummary = history.length ? await generateInquirySummary(history, {
        name: conv.name, make: conv.make, model: conv.model, year: conv.year,
        mileage: conv.mileage, specs: conv.specs, loan: conv.loan,
        sell_timeline: conv.sell_timeline,
        owner_status: conv.owner_status,
        car_conditions: conv.car_conditions,
      }).catch(() => "") : "WhatsApp contact recovered after reply authentication failure. Only the phone number was saved; the original message text is unavailable. No inspection has been confirmed. Please follow up.";

      // Only after Kaya has asked once for an exact time without getting an answer:
      // choose a :15 slot and save it as pending customer confirmation.
      const lastAssistant = [...history].reverse().find(m => m.role === "assistant")?.content ?? "";
      const notReady = notesC.includes("NOT READY YET");
      let state = flowState(conv);
      const date = String(state.proposedDate ?? "");
      const today = new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
      const canDefault = !!conv.flow_state && state.status === "visit_proposed" && state.question === "exact_time" && !state.proposedTime && /^\d{4}-\d{2}-\d{2}$/.test(date)
        && date >= today && new Date(`${date}T12:00:00Z`).getUTCDay() !== 0
        && /what exact (?:arrival )?time/i.test(lastAssistant);
      if (canDefault && !recoveryOnly) {
        try {
        const turn = { state: structuredClone(state), updates: {} as Record<string, any>, reply: "", defaultDate: date };
        await chooseDefault(turn, conv.phone);
        if (turn.state.status === "default_pending") {
          await sendWhatsAppMessage(conv.phone, turn.reply);
          const messages = [...history, { role: "assistant", content: turn.reply }].slice(-40);
          const patch = { ...turn.updates, messages };
          const saved = await supabase.from(TABLE).update(patch).eq("phone", conv.phone);
          if (saved.error) throw saved.error;
          Object.assign(conv, patch);
          state = flowState(conv);
        }
        } catch (e) {
          console.error("[cron/timeout] booking reply failed; forwarding lead without a new booking:", e);
        }
      }
      const ok = await createBiginContact({
        ...conv,
        phone_number: conv.phone_number || conv.phone,
        sales_inquiry: salesInquiry,
        inspection_booked: inspectionBooked(conv),
        clear_appointment: !inspectionBooked(conv),
        inquiry_summary: [!conv.last_message_at ? "Recovered stalled WhatsApp inquiry." : "", STATUS_LABELS[flowState(conv).status], state.proposedDate ? `Proposed visit: ${state.proposedDate} ${state.proposedTime || "time not chosen"}` : "", state.consent === "declined" ? "No personal callback consent; customer will contact us." : "", inquirySummary].filter(Boolean).join("\n\n"),
        owner_status: conv.owner_status,
        car_conditions: conv.car_conditions,
      } as any);

      if (!ok) throw new Error("Bigin push failed");
      if (state.pendingTask) {
        const task = await createChangeTask({ ...conv, appointment_date: state.pendingTask.date, appointment_time: state.pendingTask.time }, "OTHER", `${STATUS_LABELS[state.status]} — ${state.pendingTask.request}`);
        if (!task.ok) throw new Error("Appointment change task pending retry");
        delete state.pendingTask;
        const changed = await supabase.from(TABLE).update({ flow_state: state }).eq("phone", conv.phone);
        if (changed.error) throw changed.error;
      }
      if (state.consent === "accepted" || !conv.flow_state && notReady && /Accepted personal call/.test(notesC)) await moveLeadToCallBack(conv.phone);
      const marked = await supabase.from(TABLE).update({ bigin_pushed_at: new Date().toISOString() }).eq("phone", conv.phone);
      if (marked.error) throw marked.error;
      pushed++;
    } catch (e) {
      failed++;
      console.error(`[cron/timeout] failed to push ${conv.phone}:`, e);
    }
  }
  return { pushed, total: stale.length, failed };
}
