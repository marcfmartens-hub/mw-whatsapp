import { getConversation, updateConversation } from "@/lib/supabase";
import { createBiginContact } from "@/lib/bigin";
import { generateInquirySummary, ConversationMessage } from "@/lib/claude";

export type Milestone = "DUPLICATE" | "RESCHEDULE" | "CANCEL" | "FOLLOW UP";
export type PushOpts = {
  salesInquiry?: string; inspectionBooked?: boolean; altPhone?: string; clearAppointment?: boolean;
  topNote?: string;
  // Milestone → new record in Bigin; red tag if the customer already exists there
  milestone?: Milestone;
};

// New records are created 5 minutes after the milestone, so anything that changes in those
// 5 minutes (number, name, a reschedule…) is in the record — and in Bigin's automatic
// "New Leads" pipeline copy, which only takes the data present at creation.
const DELAY_MS = 5 * 60 * 1000;
const PRIORITY: Record<Milestone, number> = { "FOLLOW UP": 1, "DUPLICATE": 2, "RESCHEDULE": 3, "CANCEL": 4 };

type Pending = PushOpts & { due: string; reason: string };
function readPending(conv: any): Pending | null {
  try { return conv?.bigin_pending ? JSON.parse(conv.bigin_pending) as Pending : null; } catch { return null; }
}

export async function pushLead(phone: string, reason: string, opts: PushOpts = {}): Promise<void> {
  const latest = await getConversation(phone).catch(() => null);
  if (!latest) return;
  const hasQueue = "bigin_pending" in (latest as any);   // column exists?
  const pending = readPending(latest);

  if (opts.milestone && hasQueue) {
    // Queue (or merge into the queued push): keep the first due time, the most important tag,
    // and the latest details. A cancel / reschedule note wins over an earlier one.
    const merged: Pending = pending
      ? {
          ...pending, ...opts,
          milestone: PRIORITY[opts.milestone] >= PRIORITY[pending.milestone ?? "FOLLOW UP"] ? opts.milestone : pending.milestone,
          topNote: opts.topNote ?? pending.topNote,
          due: pending.due, reason: `${pending.reason} + ${reason}`,
        }
      : { ...opts, due: new Date(Date.now() + DELAY_MS).toISOString(), reason };
    try {
      await updateConversation(phone, { bigin_pending: JSON.stringify(merged) } as any);
      console.log(`[bigin] queued (${merged.reason}) for ${phone}, due ${merged.due}`);
      return;
    } catch (e) {
      console.warn("[bigin] queue failed — pushing now:", e);
    }
  }
  // A queued push will carry the latest data when it fires — don't update separately meanwhile
  if (!opts.milestone && pending) {
    console.log(`[bigin] (${reason}) skipped for ${phone} — push queued for ${pending.due}`);
    return;
  }
  await pushNow(phone, reason, opts);
}

// Called by the cron every minute: send queued pushes that are due
export async function flushPending(phone: string): Promise<boolean> {
  const conv = await getConversation(phone).catch(() => null);
  const pending = readPending(conv);
  if (!pending || Date.parse(pending.due) > Date.now()) return false;
  await updateConversation(phone, { bigin_pending: null } as any).catch(() => {});
  const { due, reason, ...opts } = pending;
  await pushNow(phone, `${reason} (queued)`, opts);
  return true;
}

export async function pushNow(
  phone: string,
  reason: string,
  opts: PushOpts = {}
): Promise<void> {
  try {
    const latest = await getConversation(phone);
    if (!latest) return;
    const history: ConversationMessage[] = Array.isArray(latest.messages) ? latest.messages : [];
    const aiSummary = await generateInquirySummary(history, latest as any).catch(() => "");
    const notesAll = String((latest as any).car_conditions ?? "");
    const otherCars = notesAll.split(" | ").filter(n => /^(Other car|Also selling|Cars):/.test(n));
    const buyerNote = [
      /BUYER:/.test(notesAll) ? "BUYER — wants to buy a car, not selling." : /Trade-in:/.test(notesAll) ? "TRADE-IN — customer also wants to buy a car." : "",
      /OPTED OUT:/.test(notesAll) ? "OPTED OUT — customer asked not to be messaged. Do not contact." : "",
      /Prefers WhatsApp/.test(notesAll) ? "Prefers WhatsApp — no phone calls." : "",
      /HIYAZA:/.test(notesAll) ? "HIYAZA ONLY — no plates/insurance, no appointment booked." : "",
      notesAll.match(/Customer expects: AED [\d,]+/)?.[0] ?? "",
    ].filter(Boolean).join("\n");
    const summary = [opts.topNote ?? "", buyerNote, otherCars.length ? `Cars mentioned:\n${otherCars.map(n => "- " + n.replace(/^(Other car|Also selling|Cars):\s*/, "")).join("\n")}` : "", aiSummary].filter(Boolean).join("\n\n");
    const booked = opts.inspectionBooked ?? !!(latest.appointment_date && latest.appointment_time);
    const ok = await createBiginContact({
      ...latest,
      phone_number: latest.phone_number || phone,
      alternative_phone: opts.altPhone ?? latest.alternative_phone ?? undefined,
      sales_inquiry: /Trade-in:/.test(notesAll) && (!opts.salesInquiry || ["Cash Deal", "Consignment", "Not Sure - Need Advise"].includes(opts.salesInquiry))
        ? "Trade-in Inquiry" : opts.salesInquiry,
      inspection_booked: booked,
      inquiry_summary: summary,
      clear_appointment: opts.clearAppointment ?? false,
      milestone_tag: opts.milestone,
    } as any);
    if (ok) await updateConversation(phone, { bigin_pushed_at: new Date().toISOString() } as any);
    if (summary) await updateConversation(phone, { inquiry_summary: summary } as any).catch(() => {});
    console.log(`[bigin] push (${reason}) for ${phone}: ${ok ? "ok" : "FAILED"}`);
  } catch (e) {
    console.error(`[bigin] push (${reason}) error for ${phone}:`, e);
  }
}

