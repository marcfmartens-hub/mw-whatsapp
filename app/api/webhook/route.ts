import { NextRequest, NextResponse } from "next/server";
import { getOrCreateConversation, updateConversation, resetConversation, getConversation, Conversation } from "@/lib/supabase";
import { getKayaReply, extractVehicleInfo, extractAppointment, generateInquirySummary, VehicleFields, ConversationMessage } from "@/lib/claude";
import { sendWhatsAppMessage, sendWhatsAppImage } from "@/lib/meta";
import { createBiginContact, toIsoDate } from "@/lib/bigin";
import { CAR_MODELS } from "@/lib/carData";
import { estimateCarValue } from "@/lib/valuation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RESET_KEYWORD = "reset chat 007";

const LOCATION_KEYWORDS = /\b(location|address|where are you|where is|how to get|directions?|map|find you|your office|office location|come to you)\b/i;

const LOCATION_IMAGE_URL = "https://mw-whatsapp2.vercel.app/location.jpg";

const LOCATION_TEXT = `📍 Mister Wheelz Car Buyers\n\n409 Sheikh Zayed Rd\nF1rst Motors Bldg.\n1st Floor, Office 7\nAl Quoz First - Dubai\n\nEntrance - Left side of the Building\n\nhttps://maps.app.goo.gl/4L7EkwGZfnffofuh8`;

// ---- GET: Meta webhook verification ----
export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = process.env.WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && token && verifyToken && token === verifyToken) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

// Which raw field to save at each step (the customer's plain text answer).
// Vehicle details (make/model/year/mileage/specs) are extracted separately
// from every message and saved on top of this.
const FIELD_BY_STEP: Record<number, keyof Conversation | undefined> = {
  0: undefined,          // first contact — nothing to save
  1: "name",             // customer gives name
  2: "car",              // customer states car info (phone always auto-saved from sender)
  3: "car",              // car info (UAE skip phone step → goes straight here)
  4: undefined,          // mileage+specs collected via vehicle extraction only
  5: "loan",             // loan / mortgage status
  6: "sell_timeline",    // sell method: cash / consignment / not sure
  7: "appointment",      // appointment day/time — Bigin fires after this
};

const FINAL_STEP  = 7;
const CLOSING_STEP = 8;

// Sell method detection
const SELL_METHOD_CASH        = /\b(cash|direct|buy now|sell now|sell fast|quick sale|immediately|instant)\b/i;
const SELL_METHOD_CONSIGNMENT = /\b(consign|consignment|list|listing|display|market|higher price|best price)\b/i;
const SELL_METHOD_NOT_SURE    = /\b(not sure|unsure|don.?t know|undecided|still deciding|what.?s better|which is better|explain|difference|options?)\b/i;

// Handoff detection — complex conversations that need a human
// Explicit asks for a person only. Questions like "how does it work?" are answered by Kaya.
const HANDOFF_SIGNALS = /\b(too many questions|call me|(speak|talk)\s+(to|with)\s+(a\s+)?(someone|somebody|person|human|agent|manager|team)|real person|human agent)\b/i;

// Special inquiry types
const HOME_VISIT_PATTERN  = /\b(home\s*(visit|pick\s*up|collection|pickup)|come\s*to\s*(me|my|us)|pick\s*(it\s*)?up|collect\s*(from|at)|i\s*can.?t\s*(come|bring)|unable\s*to\s*(come|drive|bring)|mobility|wheelchair|disabled)\b/i;
const TRADE_IN_PATTERN    = /\b(trade[\s-]?in|trade\s*my|swap|exchange|part[\s-]?exchange|replace\s*(my|the)|get\s*(a\s*)?new\s*car|upgrade\s*(my|the)|in\s*exchange\s*for)\b/i;
const PRICE_OFFER_PATTERN = /\b(how\s*much|price|offer|estimate|valuation|value|worth|what\s*(will\s*you\s*pay|do\s*you\s*give|can\s*i\s*get)|give\s*me\s*(a\s*)?(price|number|figure|quote))\b/i;

// Ownership detection
const OWNER_PATTERN = /\b(my\s*car|i\s*(own|am\s*the\s*owner)|registered\s*(in\s*my\s*name|owner)|it.?s\s*mine)\b/i;
const POA_PATTERN   = /\b(poa|power\s*of\s*attorney|selling\s*for|on\s*behalf|not\s*my\s*car|friend.?s\s*car|family.?s\s*car|brother.?s|sister.?s|father.?s|mother.?s|husband.?s|wife.?s)\b/i;

// Car condition signals — extract when mentioned
const CONDITION_PATTERN = /\b(accident|damage|damaged|dent|scratch|flood|fire|total\s*loss|write[\s-]?off|modified|modification|tuned|engine|gearbox|transmission|service|fine|fines|traffic\s*fine|salik|document|registration|mulkiya|expired|missing|lost|stolen|bank\s*loan|finance|mortgage)\b/i;

// Insult detection
// Real abuse only. Objections ("is this a scam?", "rubbish prices", "terrible offers") are NOT insults —
// Kaya handles those as normal objections.
const INSULT_PATTERN = /\b(stupid|idiot|dumb|moron|asshole|ass hole|bastard|bitch|fuck(?:ing|er)?|f\*+k|motherfucker|son of a bitch|dickhead|retard)\b/i;

const URGENT_KEYWORDS  = /\b(today|now|right now|asap|any\s*time|whenever|when the price is right|immediately|urgent)\b/i;
const GREETING_ONLY   = /^(hi+|hey+|hello+|hiya|yo|howdy|good\s*(morning|afternoon|evening|day|evening))[\s!.,]*$/i;

function getDubaiHour(): number {
  return new Date(Date.now() + 4 * 60 * 60 * 1000).getUTCHours();
}

function getDubaiTomorrow(): string {
  const d = new Date(Date.now() + 28 * 60 * 60 * 1000);
  const DAYS   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const date   = d.getUTCDate();
  const sfx    = [11,12,13].includes(date) ? "th"
                 : date % 10 === 1 ? "st"
                 : date % 10 === 2 ? "nd"
                 : date % 10 === 3 ? "rd" : "th";
  return `${DAYS[d.getUTCDay()]} ${date}${sfx} of ${MONTHS[d.getUTCMonth()]}`;
}

function extractNameFromMessage(text: string): string | null {
  const m = text.match(
    /(?:i'?m\s+|i\s+am\s+|my\s+name(?:\s+is)?\s+|it'?s\s+|this\s+is\s+|name\s+is\s+|call\s+me\s+)([A-Za-z][a-z]*(?:\s+[A-Za-z][a-z]*)?)/i
  );
  if (m) return m[1].trim().replace(/\b\w/g, (c) => c.toUpperCase());
  const trimmed = text.trim();
  if (/^[A-Za-z]+(?:\s+[A-Za-z]+)?$/.test(trimmed) && trimmed.length <= 30)
    return trimmed.replace(/\b\w/g, (c) => c.toUpperCase());
  return null;
}

function quickModelMatch(text: string, make: string): string | undefined {
  const models = CAR_MODELS[make];
  if (!models) return undefined;
  const sorted = [...models].sort((a, b) => b.length - a.length);
  for (const m of sorted) {
    const escaped = m.replace(/[-/]/g, "[-/]?").replace(/\s+/g, "\\s+");
    if (new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z0-9])`, "i").test(text)) return m;
  }
  return undefined;
}

function formatMileage(raw: string | null | undefined): string {
  if (!raw) return "Unknown";
  const n = parseInt(raw, 10);
  if (isNaN(n)) return `${raw} km`;
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " km";
}

// ── Bigin push — one path for every milestone ───────────────────────────────
// Called on: booking confirmed, team follow-up / handoff, and (from the cron) 12-min silence.
// Bigin upserts by phone, so pushing more than once just updates the same contact.
async function pushLead(
  phone: string,
  reason: string,
  opts: { salesInquiry?: string; inspectionBooked?: boolean; altPhone?: string; clearAppointment?: boolean } = {}
): Promise<void> {
  try {
    const latest = await getConversation(phone);
    if (!latest) return;
    const history: ConversationMessage[] = Array.isArray(latest.messages) ? latest.messages : [];
    const summary = await generateInquirySummary(history, latest as any).catch(() => "");
    const booked = opts.inspectionBooked ?? !!(latest.appointment_date && latest.appointment_time);
    const ok = await createBiginContact({
      ...latest,
      phone_number: latest.phone_number || phone,
      alternative_phone: opts.altPhone ?? latest.alternative_phone ?? undefined,
      sales_inquiry: opts.salesInquiry,
      inspection_booked: booked,
      inquiry_summary: summary,
      clear_appointment: opts.clearAppointment ?? false,
    } as any);
    if (ok) await updateConversation(phone, { bigin_pushed_at: new Date().toISOString() } as any);
    console.log(`[bigin] push (${reason}) for ${phone}: ${ok ? "ok" : "FAILED"}`);
  } catch (e) {
    console.error(`[bigin] push (${reason}) error for ${phone}:`, e);
  }
}

async function appendHistory(phone: string, history: ConversationMessage[], user: string, assistant: string) {
  await updateConversation(phone, {
    messages: [...history, { role: "user", content: user }, { role: "assistant", content: assistant }].slice(-40),
    last_message_at: new Date().toISOString(),
  } as any).catch(() => {});
}

// Only real table columns — extractor extras like typo_check made the whole save fail,
// so make/model/year/mileage/specs never reached the DB (or Bigin).
function vehicleDbFields(v: VehicleFields): Partial<Conversation> {
  const out: Partial<Conversation> = {};
  for (const k of ["make", "model", "year", "mileage", "specs"] as const) {
    const val = v[k];
    if (val && val !== "Unknown") (out as any)[k] = val;
    else if (k === "specs" && val === "Unknown") out.specs = "Unknown";
  }
  return out;
}

type NextAction =
  | { type: "ASK_NAME" }
  | { type: "ASK_UAE_PHONE" }
  | { type: "ASK_CAR_DETAILS" }
  | { type: "ASK_MILEAGE_SPECS" }
  | { type: "ASK_SPECS" }
  | { type: "ASK_MORTGAGE" }
  | { type: "ASK_AMOUNT" }
  | { type: "CLARIFY_MODEL" }
  | { type: "SHOW_SUMMARY" }
  | { type: "SHOW_FULL_SUMMARY" }
  | { type: "OFFER_CALLBACK" };

function describeAction(a: NextAction): string {
  switch (a.type) {
    case "ASK_NAME":         return `Greet by time of day (Good morning/afternoon/evening), then ask: "What car are you looking to sell?"`;
    case "ASK_UAE_PHONE":    return "Ask: \"On which UAE number can we reach you on?\"";
    case "ASK_CAR_DETAILS":  return "Ask for the car make, model and year.";
    case "ASK_MILEAGE_SPECS":return "Ask for BOTH the mileage AND whether the car is GCC or non-GCC specs — in one question.";
    case "ASK_SPECS":        return `Ask ONLY: "Is it GCC or non-GCC specs?"`;
    case "ASK_MORTGAGE":     return `Ask: "Is there any outstanding mortgage on the car?"`;
    case "ASK_AMOUNT":       return `Ask: "How much is the outstanding balance?"`;
    case "CLARIFY_MODEL":    return "Ask the customer to confirm or clarify the car model and year.";
    case "SHOW_SUMMARY":      return `Show the car summary (plain, no emojis) then ask "When are you planning to sell the car?"`;
    case "SHOW_FULL_SUMMARY": return `Show the car summary including mortgage (plain, no emojis) then ask "When are you planning to sell the car?"`;
    case "OFFER_CALLBACK":   return "Tell the customer the purchasing team will call them back within the hour, and they're welcome to come in whenever.";
  }
}

function buildDirectResponse(
  action: NextAction,
  name: string | null | undefined,
  known: { make?: string | null; model?: string | null; year?: string | null;
           mileage?: string | null; specs?: string | null;
           loan?: string | null; mortgage_amount?: string | null }
): string {
  const n = name ? `, ${name}` : "";
  switch (action.type) {
    case "ASK_NAME":
      // Customer didn't give a name — don't chase it, move on to the car
      {
        const h = getDubaiHour();
        const greet = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
        return `${greet}! What car are you looking to sell?`;
      }
    case "ASK_UAE_PHONE":
      return `Hi${n}! Which UAE number is best to reach you on?`;
    case "ASK_CAR_DETAILS": {
      const hasMake  = !!(known.make  && known.make  !== "Unknown");
      const hasModel = !!(known.model && known.model !== "Unknown");
      const hasYear  = !!known.year;
      if (hasMake && hasModel) {
        return `Nice! Which year is it?`;
      } else if (hasMake && hasYear) {
        return `Nice! Which model is it?`;
      } else if (hasMake) {
        return `Nice! What's the model and year?`;
      }
      return `Sure${n}, I can help! Could you share the make, model and year of your car?`;
    }
    case "ASK_MILEAGE_SPECS": {
      const hasSpecs   = !!(known.specs && known.specs !== "Unknown");
      const hasMileage = !!known.mileage;
      if (hasSpecs && !hasMileage) return `Got it${n}. What's the mileage on it?`;
      if (hasMileage && !hasSpecs) return `Got it${n}. Is it GCC or non-GCC specs?`;
      return `Got it${n}. Could you tell me the mileage and whether it's GCC or non-GCC specs?`;
    }
    case "ASK_SPECS":
      return `Got it${n}! Is it GCC or non-GCC specs?`;
    case "ASK_MORTGAGE":
      return "Is there any outstanding mortgage on the car?";
    case "ASK_AMOUNT":
      return "How much is the outstanding balance?";
    case "CLARIFY_MODEL":
      return `Could you confirm the car model and year${n}?`;
    case "SHOW_SUMMARY":
    case "SHOW_FULL_SUMMARY":
      return "When are you planning to sell the car?";
    case "OFFER_CALLBACK":
      return "No worries — I'll have someone from our team call you back within the hour. Whenever you're ready to come in, we're here for you.";
  }
}

// Opening hours (Dubai): Mon–Thu & Sat 10:00–19:00, Fri 12:00–19:00, Sun closed. Last slot 18:30.
// Returns a plain-English hint telling Kaya which day to propose for the inspection.
function getBookingSlot(): string {
  const DAYS   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const OPEN: Record<number, number | null> = { 0: null, 1: 10, 2: 10, 3: 10, 4: 10, 5: 12, 6: 10 };
  const now = new Date(Date.now() + 4 * 60 * 60 * 1000);
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const fmt = (d: Date) => {
    const n = d.getUTCDate();
    const sfx = [11,12,13].includes(n) ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
    return `${DAYS[d.getUTCDay()]} ${n}${sfx} of ${MONTHS[d.getUTCMonth()]}`;
  };
  // Before 15:00 → today only · 15:00–17:00 → today or next day · after 17:00 → next day only
  const todayOpen = OPEN[now.getUTCDay()] != null && mins < 17 * 60;
  const offerNextToo = mins >= 15 * 60;
  let nextLabel = "tomorrow", nextFull = "";
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now.getTime() + i * 86400000);
    if (OPEN[d.getUTCDay()] != null) {
      nextLabel = i === 1 ? "tomorrow" : `on ${DAYS[d.getUTCDay()]}`;
      nextFull = `${fmt(d)}, opens ${OPEN[d.getUTCDay()]}:00`;
      break;
    }
  }
  const todayWord = now.getUTCHours() < 12 ? "today" : "this afternoon";
  const question = !todayOpen ? `What time can you come in ${nextLabel}?`
    : offerNextToo ? `What time can you come in ${todayWord} or ${nextLabel}?`
    : `What time can you come in ${todayWord}?`;
  return `Ask exactly: "${question}" — always ask for a TIME, never a yes/no question. ` +
    (todayOpen ? `Branch is open today until 19:00 (last slot 18:30). ` : `Too late for today. Do NOT hand off to the team. `) +
    `Next opening day: ${nextFull}.`;
}

function getDubaiDateStr(): string {
  const d = new Date(Date.now() + 4 * 60 * 60 * 1000);
  const DAYS   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function getDubaiDateTime(): string {
  const d = new Date(Date.now() + 4 * 60 * 60 * 1000);
  const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${d.getUTCDate()} ${d.getUTCFullYear()}, ${hh}:${mm}`;
}

interface IncomingMessage {
  from: string;
  id: string;
  text?: { body?: string };
  image?: { caption?: string };
  type: string;
}

function extractMessage(body: any): IncomingMessage | null {
  try {
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    if (!value?.messages || value.messages.length === 0) return null;
    const message = value.messages[0];
    return { from: message.from, id: message.id, text: message.text, image: message.image, type: message.type };
  } catch (error) {
    console.error("extractMessage parse error:", error);
    return null;
  }
}

// ---- POST: incoming message handler ----
export async function POST(req: NextRequest) {
  let body: any;

  try {
    body = await req.json();
  } catch (error) {
    console.error("Failed to parse webhook body:", error);
    return NextResponse.json({ status: "ignored" }, { status: 200 });
  }

  try {
    const message = extractMessage(body);
    if (!message) return NextResponse.json({ status: "ignored" }, { status: 200 });

    const ownPhoneNumberId = process.env.META_PHONE_NUMBER_ID;
    if (ownPhoneNumberId && message.from === ownPhoneNumberId) {
      return NextResponse.json({ status: "ignored" }, { status: 200 });
    }

    const phone   = message.from;
    const isUAE   = phone.startsWith("971");
    const isImageMessage = message.type === "image";
    let messageText = message.text?.body?.trim() ?? message.image?.caption?.trim() ?? "";

    // ── Voice notes / media without text ────────────────────────────
    if (message.type === "reaction") return NextResponse.json({ status: "ignored" }, { status: 200 });
    if (!messageText && message.type === "audio") {
      await sendWhatsAppMessage(phone, "Sorry, I can't listen to voice notes. Could you type your message instead?");
      return NextResponse.json({ status: "voice_note" }, { status: 200 });
    }
    if (!messageText && !isImageMessage && message.type !== "text" && message.type !== "location") {
      await sendWhatsAppMessage(phone, "Thanks! Could you type your message so I can help?");
      return NextResponse.json({ status: "media_no_text" }, { status: 200 });
    }

    // ── English only ───────────────────────────────────────────────
    // Arabic, Cyrillic, Indian scripts, CJK, Korean → never reply in that language, ask for English
    if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0400-\u04FF\u0900-\u0DFF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(messageText)) {
      await sendWhatsAppMessage(phone, "Sorry, I can only assist in English. Could you please continue in English?");
      return NextResponse.json({ status: "non_english" }, { status: 200 });
    }

    // ── Reset trigger ──────────────────────────────────────────────
    if (messageText.toLowerCase() === RESET_KEYWORD) {
      try {
        await resetConversation(phone);
        const reply = await getKayaReply(0, [], "", {});
        await sendWhatsAppMessage(phone, reply);
        // Greeting sent → next message is the name (step 1)
        await getOrCreateConversation(phone);
        await updateConversation(phone, {
          step: 1,
          phone_number: phone,
          last_message_at: new Date().toISOString(),
          messages: [{ role: "assistant", content: reply }],
        } as any);
      } catch (e) {
        // Don't fake success — if the reset failed, say so, otherwise it looks like it worked
        console.error("reset handler error:", e);
        await sendWhatsAppMessage(phone, `⚠️ Reset failed: ${(e as any)?.message ?? e}`).catch(() => {});
      }
      return NextResponse.json({ status: "reset" }, { status: 200 });
    }
    // ──────────────────────────────────────────────────────────────

    // ── Location trigger ───────────────────────────────────────────
    const isLocationMessage = message.type === "location";
    const isLocationRequest = LOCATION_KEYWORDS.test(messageText);
    if (isLocationMessage || isLocationRequest) {
      await sendWhatsAppImage(phone, LOCATION_IMAGE_URL);
      await sendWhatsAppMessage(phone, LOCATION_TEXT);
      const convForLocation = await getOrCreateConversation(phone);
      if ((convForLocation.step ?? 0) >= FINAL_STEP - 1) {
        const q = getBookingSlot().match(/Ask exactly: "([^"]+)"/)?.[1] ?? "What time can you come in tomorrow?";
        await sendWhatsAppMessage(phone, q);
      }
      return NextResponse.json({ status: "location_sent" }, { status: 200 });
    }
    // ──────────────────────────────────────────────────────────────

    const conversation = await getOrCreateConversation(phone);

    // Stale-state guard: if step > 1 but no message history, the conversation
    // is in a corrupt/leftover state. Silently reset before continuing.
    const RE_INTRO = /^(hi+|hey+|hello+|hiya|yo|good\s*(morning|afternoon|evening|day))[\s!.,]*(?:i'?m|my\s+name\s+is|i\s+am|it'?s|this\s+is|call\s+me)?\s+[A-Za-z]+/i;
    const isReIntro = RE_INTRO.test(messageText);
    const isStaleNoHistory = (conversation.step ?? 0) > 1 && (!Array.isArray(conversation.messages) || conversation.messages.length === 0);
    const isRestart = (conversation.step ?? 0) >= 3 && isReIntro;

    if (isStaleNoHistory || isRestart) {
      console.log(`[kaya] resetting for ${phone}: staleNoHistory=${isStaleNoHistory} reIntro=${isRestart} step=${conversation.step}`);
      await resetConversation(phone);
      const fresh = await getOrCreateConversation(phone);
      for (const k of Object.keys(conversation)) delete (conversation as any)[k];
      Object.assign(conversation, fresh);
    }

    // Always save the sender's phone number — no need to ask for it
    if (!conversation.phone_number) {
      await updateConversation(phone, { phone_number: phone });
      conversation.phone_number = phone;
    }

    // Insult detection — track count and close after second insult
    if (INSULT_PATTERN.test(messageText)) {
      const insultCount = ((conversation as any).insult_count ?? 0) + 1;
      await updateConversation(phone, { insult_count: insultCount } as any);
      if (insultCount >= 2) {
        // Second insult — close conversation and hand off
        await sendWhatsAppMessage(phone, "I'm going to pass you on to one of our team members who can assist you better. Take care.");
        await pushLead(phone, "insult close", { salesInquiry: "Other" });
        return NextResponse.json({ status: "closed_insult" }, { status: 200 });
      } else {
        // First insult — respond with empathy
        await sendWhatsAppMessage(phone, "I understand, we all have frustrating moments sometimes. I'm here to help whenever you're ready.");
        return NextResponse.json({ status: "insult_warned" }, { status: 200 });
      }
    }

    if (conversation.last_msg_id && conversation.last_msg_id === message.id) {
      return NextResponse.json({ status: "duplicate" }, { status: 200 });
    }

    // Mark this message ID immediately to prevent duplicate processing during async Claude call
    // Re-fetch after stamp so we see any reset that completed between our initial fetch and now
    await updateConversation(phone, { last_msg_id: message.id } as any).catch(() => {});
    const freshConversation = await getConversation(phone).catch(() => null);
    if (freshConversation) Object.assign(conversation, freshConversation);

    // ── Burst handling ─────────────────────────────────────────────
    // Customers often send 2–3 quick messages ("fine monday 7pm" / "actually 6"). Record this
    // message, wait a few seconds, and only the LATEST message replies — covering the whole burst.
    {
      const prior = (conversation.messages ?? []) as ConversationMessage[];
      await updateConversation(phone, { messages: [...prior, { role: "user", content: messageText }].slice(-40) } as any).catch(() => {});
      await new Promise(r => setTimeout(r, 4000));
      const after = await getConversation(phone).catch(() => null);
      if (after && after.last_msg_id && after.last_msg_id !== message.id) {
        return NextResponse.json({ status: "superseded" }, { status: 200 });
      }
      // Combine the trailing customer messages (the burst) into one, history = everything before
      const msgs = ((after?.messages ?? [...prior, { role: "user", content: messageText }]) as ConversationMessage[]);
      let i = msgs.length;
      while (i > 0 && msgs[i - 1].role === "user") i--;
      const burst = msgs.slice(i).map(m => m.content).filter(Boolean);
      if (after) Object.assign(conversation, after);
      conversation.messages = msgs.slice(0, i) as any;
      if (burst.length > 1) messageText = burst.join("\n");
    }

    // ── Special inquiry detection (any step) ──────────────────────────────
    // Trade-in inquiry → collect info, push to Bigin, hand off.
    // Home visits are NOT offered — Kaya answers those herself (see HOME VISITS in lib/claude.ts).
    const isHomeVisit = false;
    const isTradeIn   = TRADE_IN_PATTERN.test(messageText);
    if ((isHomeVisit || isTradeIn) && (conversation.step ?? 0) > 0) {
      const inquiryType = isHomeVisit ? "Home Visit Inquiry" : "Trade-in Inquiry";
      const inquiryTag  = isHomeVisit ? "home_visit" : "trade_in";
      await updateConversation(phone, { sell_timeline: `sell_method:${inquiryTag}` } as any);
      const replyMsg = isHomeVisit
        ? "Of course, we can look into that for you. Let me pass your details to our team and they'll be in touch with you shortly to arrange."
        : "Happy to discuss that. Let me pass your details to our team and they'll reach out to you shortly to go over the options.";
      await sendWhatsAppMessage(phone, replyMsg);
      await appendHistory(phone, (conversation.messages ?? []) as ConversationMessage[], messageText, replyMsg);
      await pushLead(phone, "trade-in follow-up", { salesInquiry: "Trade-in Inquiry" });
      return NextResponse.json({ status: "special_inquiry" }, { status: 200 });
    }
    // ─────────────────────────────────────────────────────────────────────

    const currentStep = conversation.step ?? 0;
    const fieldToSave = FIELD_BY_STEP[currentStep];

    const coreUpdates: Partial<Conversation> = {
      last_msg_id: message.id,
      last_message_at: new Date().toISOString(),
    };
    if (fieldToSave && messageText) {
      const isLoanAmountFollowUp = fieldToSave === "loan" && !!conversation.loan;
      const isGreetingOnly = fieldToSave === "name" && GREETING_ONLY.test(messageText);
      if (!isLoanAmountFollowUp && !isGreetingOnly) {
        const valueToSave = fieldToSave === "name"
          ? extractNameFromMessage(messageText)
          : messageText;
        if (valueToSave !== null) {
          (coreUpdates as any)[fieldToSave] = valueToSave;
        }
      }
    }

    // Name given later in the chat ("my name is Louise") — save it if we don't have one yet.
    // Only explicit phrases here; bare words would catch things like "Cash" or "Tomorrow".
    if (!conversation.name && currentStep >= 2 && !(coreUpdates as any).name) {
      const nm = messageText.match(/\b(?:my\s+name\s+is|my\s+name'?s|i'?m|i\s+am|this\s+is|call\s+me|name\s*:)\s+([A-Za-z]{2,}(?:\s+[A-Za-z]{2,})?)\b/i);
      const NOT_NAMES = /^(selling|looking|interested|not|ok|okay|fine|good|here|coming|ready|sure|busy|planning|going|thinking|in|at|from|the|a|an|out|done|happy|available|free|asking|trying)\b/i;
      if (nm && !NOT_NAMES.test(nm[1])) {
        (coreUpdates as any).name = nm[1].trim().replace(/\b\w/g, c => c.toUpperCase());
      }
    }

    const alreadyKnown: VehicleFields = {
      make:    (conversation.make    && conversation.make    !== "Unknown") ? conversation.make    : undefined,
      model:   (conversation.model   && conversation.model   !== "Unknown") ? conversation.model   : undefined,
      year:    conversation.year    ?? undefined,
      mileage: conversation.mileage ?? undefined,
      specs:   conversation.specs   ?? undefined,
    };
    // Don't extract vehicle info at step 0 — it's the greeting step, ask for name first
    const vehicleUpdates = currentStep === 0 ? {} : await extractVehicleInfo(messageText, alreadyKnown);

    if (!vehicleUpdates.model || vehicleUpdates.model === "Unknown") {
      const effectiveMake = vehicleUpdates.make ?? conversation.make;
      if (effectiveMake && effectiveMake !== "Unknown") {
        const found = quickModelMatch(messageText, effectiveMake);
        if (found) {
          vehicleUpdates.model = found;
          if (vehicleUpdates.typo_check) {
            vehicleUpdates.typo_check = vehicleUpdates.typo_check.filter(
              (t) => t.field !== "model"
            );
            if (vehicleUpdates.typo_check.length === 0) delete vehicleUpdates.typo_check;
          }
        }
      }
    }

    if (alreadyKnown.mileage && vehicleUpdates.mileage) delete vehicleUpdates.mileage;
    if (alreadyKnown.specs   && vehicleUpdates.specs)   delete vehicleUpdates.specs;

    // Deterministic backup for specs + mileage — never re-ask something the customer already said
    if (currentStep >= 2 && currentStep <= 4) {
      if (!alreadyKnown.specs && (!vehicleUpdates.specs || vehicleUpdates.specs === "Unknown")) {
        if (/\bnon[\s-]?gcc\b|\b(american|us|usa|japanese|japan|canadian|european|korean)\s*spec/i.test(messageText)) vehicleUpdates.specs = "Non-GCC";
        else if (/\bgcc\b/i.test(messageText)) vehicleUpdates.specs = "GCC";
      }
      if (!alreadyKnown.mileage && !vehicleUpdates.mileage) {
        const mk = messageText.match(/\b(\d+(?:\.\d+)?)\s*k\s*(?:km|kms|kilomet\w*)?\b/i);
        const mf = messageText.match(/\b(\d{1,3}(?:[,.]\d{3})+|\d{3,7})\s*(?:km|kms|kilomet\w*)\b/i);
        if (mk) vehicleUpdates.mileage = String(Math.round(parseFloat(mk[1]) * 1000));
        else if (mf) vehicleUpdates.mileage = mf[1].replace(/[,.]/g, "");
      }
    }

    // Ownership detection — save once, don't overwrite
    if (!conversation.owner_status) {
      if (POA_PATTERN.test(messageText))   await updateConversation(phone, { owner_status: "POA" } as any).catch(() => {});
      else if (OWNER_PATTERN.test(messageText)) await updateConversation(phone, { owner_status: "Owner" } as any).catch(() => {});
    }

    // Customer mentions another car to sell → note it for the team (Kaya acknowledges it)
    if (/\b(second|another|other|2nd|one more)\s+(car|vehicle)\b|\b(two|2|three|3)\s+cars\b|\balso\s+(have|selling|want to sell)\b/i.test(messageText)) {
      const existing = (conversation as any).car_conditions ?? "";
      const note = `Also selling: ${messageText.trim()}`;
      await updateConversation(phone, { car_conditions: existing ? `${existing} | ${note}` : note } as any).catch(() => {});
      (conversation as any).car_conditions = existing ? `${existing} | ${note}` : note;
    }

    // Car conditions — append any new condition signals mentioned
    if (CONDITION_PATTERN.test(messageText)) {
      const existing = (conversation as any).car_conditions ?? "";
      const newCondition = messageText.trim();
      const updated = existing ? `${existing} | ${newCondition}` : newCondition;
      await updateConversation(phone, { car_conditions: updated } as any).catch(() => {});
    }

    const SPECS_UNSURE = /\b(i\s*don'?t\s*know|not\s*sure|no\s*idea|unsure|idk|not\s*sure\s*about|unclear)\b/i;
    const hasKnownSpecs = (vehicleUpdates.specs && vehicleUpdates.specs !== "Unknown")
                          || (conversation.specs && conversation.specs !== "Unknown");
    const specsExplicitlyUnknown = currentStep === 4 && !hasKnownSpecs && SPECS_UNSURE.test(messageText);
    if (specsExplicitlyUnknown) vehicleUpdates.specs = "Unknown";

    let apptDate = conversation.appointment_date ?? "";
    let apptTime = conversation.appointment_time ?? "";
    let altPhone: string | undefined;

    // Customer explicitly asks to book — from this message or earlier in the chat
    const BOOKING_INTENT = /\b(book|booking|appointment|inspection|inspect|schedule|come\s*(in|by|over)|bring\s*(the|my)?\s*car|visit\s*(you|your))\b/i;
    const priorUserMsgs = ((conversation.messages ?? []) as ConversationMessage[]).filter(m => m.role === "user").map(m => m.content);
    const wantsBooking = currentStep >= 1 && currentStep < FINAL_STEP &&
      (BOOKING_INTENT.test(messageText) || priorUserMsgs.some(t => BOOKING_INTENT.test(t)));

    // ── After booking: cancel or reschedule ───────────────────────────
    const hasBooking = !!(conversation.appointment_date || conversation.appointment_time);
    const CANCEL = /\b(cancel|already sold|sold it|sold the car|don'?t need (it|the appointment)|not coming|won'?t (be )?com\w*|can'?t (make it|come)|call (it )?off)\b/i;
    const RESCHEDULE = /\b(reschedul\w*|change (the |my )?(time|date|appointment)|move (it|the appointment)|instead|another (time|day)|different (time|day)|postpone|earlier|later|can we make it|make it)\b/i;
    const lastAssistantMsg = [...((conversation.messages ?? []) as ConversationMessage[])].reverse().find(m => m.role === "assistant")?.content ?? "";
    const isCancel = currentStep >= FINAL_STEP && hasBooking && CANCEL.test(messageText) && !RESCHEDULE.test(messageText);
    if (isCancel) {
      const reply = `No problem${conversation.name ? ", " + conversation.name : ""}, I've cancelled your appointment. If anything changes, just message us here.`;
      await sendWhatsAppMessage(phone, reply);
      await updateConversation(phone, { appointment_date: null, appointment_time: null, step: CLOSING_STEP, last_message_at: new Date().toISOString() } as any).catch(() => {});
      await appendHistory(phone, (conversation.messages ?? []) as ConversationMessage[], messageText, reply);
      await pushLead(phone, "appointment cancelled", { inspectionBooked: false, clearAppointment: true });
      return NextResponse.json({ status: "cancelled" }, { status: 200 });
    }
    // Reschedule: explicit change request after booking, or answering Kaya's reschedule question
    const isRebook = currentStep >= CLOSING_STEP && hasBooking &&
      (RESCHEDULE.test(messageText) || /works better|new (time|date)|which (day|time)|what time can you come/i.test(lastAssistantMsg));

    if ((currentStep === FINAL_STEP || wantsBooking || isRebook) && messageText) {
      try {
        const ea = await extractAppointment(messageText);
        // Store the real date ("tomorrow" → "2026-10-10") so it stays correct later
        if (ea.appointment_date) apptDate = toIsoDate(ea.appointment_date) ?? ea.appointment_date;
        if (ea.appointment_time) apptTime  = ea.appointment_time;
        const apptSave: Partial<Conversation> = {};
        if (ea.appointment_date) apptSave.appointment_date = apptDate;
        if (ea.appointment_time) apptSave.appointment_time  = ea.appointment_time;
        if (Object.keys(apptSave).length > 0)
          await updateConversation(phone, apptSave);
      } catch (e) {
        console.error("early appointment extraction error:", e);
      }

      // Capture alternative phone number if customer provides one at booking step
      const phoneMatch = messageText.match(/(?:\+?971|0)?[5][0-9]\d{7}/);
      if (phoneMatch) {
        const rawPhone = phoneMatch[0].replace(/\D/g, "");
        const normalised = rawPhone.startsWith("971") ? rawPhone : `971${rawPhone.replace(/^0/, "")}`;
        if (normalised !== phone) {
          altPhone = normalised;
          try { await updateConversation(phone, { alternative_phone: altPhone } as any); } catch (_) {}
        }
      }
    }

    // Track price-offer-only leads (pushed before price, then drops off)
    const isPriceOnlySignal = PRICE_OFFER_PATTERN.test(messageText) && currentStep <= 3;

    const sellTimeline = fieldToSave === "sell_timeline" ? messageText : (conversation.sell_timeline ?? undefined);
    const sellUrgent   = sellTimeline ? URGENT_KEYWORDS.test(sellTimeline) : undefined;

    let mortgageAmount: string | undefined;
    const isLoanFollowUp = fieldToSave === "loan" && !!conversation.loan;
    const loanAnswer = isLoanFollowUp ? (conversation.loan ?? "") : (fieldToSave === "loan" ? messageText : (conversation.loan ?? ""));
    const loanIsYes  = /\byes\b|\bdo\b|have a|there is|outstanding/i.test(loanAnswer);
    if (currentStep === 5 && loanIsYes && messageText) {
      // Must start with a digit — the old [\d,]+ matched the lone comma in "yes, 200k"
      // "200.000" (dot as thousands separator) → "200000"
      const amountText = messageText.replace(/\b(\d{1,3})((?:\.\d{3})+)\b/g, (_, a, b) => a + b.replace(/\./g, ""));
      const amountMatch = amountText.match(/\d[\d,]*(?:\.\d+)?\s*(?:k|m|million)?\b/i);
      if (amountMatch) {
        const raw = amountMatch[0].replace(/,/g, "").trim();
        const num = parseFloat(raw);
        mortgageAmount = /(m|million)$/i.test(raw) ? String(Math.round(num * 1_000_000))
          : /k$/i.test(raw) ? String(Math.round(num * 1000))
          : String(num);
      } else if (/\b(no|don'?t know|not sure|no idea|unknown|unsure|idk)\b/i.test(messageText)) {
        // Customer doesn't know the amount — treat as "Unknown" so step advances
        mortgageAmount = "Unknown";
      }
    }

    const carYear    = parseInt((vehicleUpdates.year ?? conversation.year) || "0");
    const carMileage = vehicleUpdates.mileage ?? conversation.mileage;
    const carSpecs   = (vehicleUpdates.specs && vehicleUpdates.specs !== "Unknown")
                         ? vehicleUpdates.specs
                         : (conversation.specs && conversation.specs !== "Unknown" ? conversation.specs : null);
    const currentYear = new Date().getFullYear();
    const hasAllVehicleFields = !!carMileage && (!!carSpecs || specsExplicitlyUnknown
                                  || conversation.specs === "Unknown");
    const skipLoan = currentStep === 4 && hasAllVehicleFields && carYear > 0 && (currentYear - carYear) >= 10;

    // ── Customer asks for a real person → push now, then collect details ─────
    // Mode is stateless: active once Kaya has sent the handoff line (HUMAN_LINE) in this chat.
    {
      const HUMAN_ASK  = /\b((speak|talk|chat)\s+(to|with)\s+(a\s+|your\s+|the\s+|one of your\s+)?(real\s+|actual\s+)?(someone|somebody|person|human|agent|manager|staff|team|people|guys)|(want|need|prefer)\s+(a\s+)?(real|actual)\s+person|human agent|call me)\b/i;
      const HUMAN_LINE = "I'll have someone from our team contact you shortly.";
      const hist = (conversation.messages ?? []) as ConversationMessage[];
      const inHumanMode = hist.some(m => m.role === "assistant" && m.content.includes(HUMAN_LINE));
      const firstAsk = !inHumanMode && currentStep >= 1 && currentStep < CLOSING_STEP && HUMAN_ASK.test(messageText);
      if ((firstAsk || inHumanMode) && currentStep < CLOSING_STEP && !(carSpecs === "Non-GCC")) {
        const vDb = vehicleDbFields(vehicleUpdates);
        const updates: Record<string, unknown> = { ...vDb, last_msg_id: message.id };
        const c = { ...conversation, ...vDb } as any;
        let conditions: string = c.car_conditions ?? "";
        const lastA = [...hist].reverse().find(m => m.role === "assistant")?.content ?? "";

        // Save answers to the questions asked last time
        if (!firstAsk && /what would you like to discuss/i.test(lastA)) {
          conditions = conditions ? `${conditions} | Wants to discuss: ${messageText}` : `Wants to discuss: ${messageText}`;
          updates.car_conditions = conditions;
        }
        if (!firstAsk && /best (number )?to reach you/i.test(lastA)) {
          const pm = messageText.match(/(?:\+?971|0)?\s*5\d[\s-]?\d{3}[\s-]?\d{4}/);
          if (pm) {
            const raw = pm[0].replace(/\D/g, "");
            const alt = raw.startsWith("971") ? raw : `971${raw.replace(/^0/, "")}`;
            if (alt !== phone) updates.alternative_phone = alt;
          }
        }

        const missingCar = (["make", "model", "year"] as const).find(k => !c[k] || c[k] === "Unknown");
        const topicDone  = /Wants to discuss:/.test(conditions);
        const phoneAsked = hist.some(m => m.role === "assistant" && /best (number )?to reach you/i.test(m.content));

        let nextQ: string | null = null;
        if (missingCar) nextQ = missingCar === "make" ? "In the meantime, could you share the make, model and year of your car?" : `Could you share the ${missingCar} of the car?`;
        else if (!topicDone) nextQ = "What would you like to discuss with the team?";
        else if (!phoneAsked) nextQ = "Which UAE number is best to reach you on?";

        const parts: string[] = [];
        if (firstAsk) parts.push(`Of course${c.name ? ", " + c.name : ""}. ${HUMAN_LINE}`);
        parts.push(nextQ ?? "Thanks, I've passed everything on. Our team will be in touch shortly. Have a nice day!");

        for (const part of parts) await sendWhatsAppMessage(phone, part);
        if (!nextQ) updates.step = CLOSING_STEP;
        await updateConversation(phone, updates as any).catch(e => console.error("human handoff save error:", e));
        await appendHistory(phone, hist, messageText, parts.join("\n\n"));
        // Push immediately on the request, and again once details are complete
        if (firstAsk || !nextQ) await pushLead(phone, firstAsk ? "asked for a person" : "person request — details complete", { salesInquiry: "Other", inspectionBooked: false });
        return NextResponse.json({ status: "human_handoff" }, { status: 200 });
      }
    }

    // ── Non-GCC / imported specs → team handoff + collect the rest ────────────
    // 1) Handoff message  2) one question at a time: missing car details →
    //    "when are you planning to sell?" → cash vs consignment (cars ≤ 8 yrs)
    // 3) close and push to Bigin. No appointment booking.
    const isNonGcc = carSpecs === "Non-GCC";
    const alreadyHandedOff = (conversation as any).non_gcc_handoff === true;
    if (((isNonGcc && currentStep >= 2) || alreadyHandedOff) && currentStep < CLOSING_STEP) {
      const firstTime = !alreadyHandedOff;
      const hist = (conversation.messages ?? []) as ConversationMessage[];
      const vDb = vehicleDbFields(vehicleUpdates);
      const updates: Record<string, unknown> = { ...vDb, last_msg_id: message.id };
      if (firstTime) updates.non_gcc_handoff = true;

      const c = { ...conversation, ...vDb } as any;
      const age = c.year ? currentYear - parseInt(c.year, 10) : 99;
      let tl: string = c.sell_timeline ?? "";
      const hasTimeline = !!tl.replace(/\s*\|?\s*sell_method:\w+/, "").trim();
      const hasMethod   = /sell_method:/.test(tl);
      const missingCar  = (["make", "model", "year", "mileage"] as const).find(k => !c[k] || c[k] === "Unknown");

      // Save this message as the answer to the question we asked last time
      let explainMethod = false;
      if (!firstTime && !missingCar) {
        if (!hasTimeline) {
          tl = messageText + (hasMethod ? ` | ${tl}` : "");
        } else if (!hasMethod && age <= 8) {
          if (/\b(difference|what.?s|explain|how does|which is better)\b/i.test(messageText) && !SELL_METHOD_CASH.test(messageText) && !SELL_METHOD_CONSIGNMENT.test(messageText)) {
            explainMethod = true;
          } else {
            const m = SELL_METHOD_CASH.test(messageText) ? "cash"
              : SELL_METHOD_CONSIGNMENT.test(messageText) ? "consignment" : "not_sure";
            tl = `${tl} | sell_method:${m}`;
          }
        }
        updates.sell_timeline = tl || null;
      }

      // Number confirmation is always the last question
      const PHONE_Q = "Which UAE number is best to reach you on?";
      const lastAssistant = [...hist].reverse().find(m => m.role === "assistant")?.content ?? "";
      const phoneAskedBefore = hist.some(m => m.role === "assistant" && /best (number )?to reach you/i.test(m.content));
      if (!firstTime && /best (number )?to reach you/i.test(lastAssistant)) {
        const pm = messageText.match(/(?:\+?971|0)?\s*5\d[\s-]?\d{3}[\s-]?\d{4}/);
        if (pm) {
          const raw = pm[0].replace(/\D/g, "");
          const alt = raw.startsWith("971") ? raw : `971${raw.replace(/^0/, "")}`;
          if (alt !== phone) updates.alternative_phone = alt;
        }
      }

      // Decide the next question
      const nowHasTimeline = !!tl.replace(/\s*\|?\s*sell_method:\w+/, "").trim();
      const nowHasMethod   = /sell_method:/.test(tl);
      let nextQ: string | null = null;
      if (missingCar) nextQ = `Just to have your information complete — could you share the ${missingCar} of the car?`;
      else if (!nowHasTimeline) nextQ = "Just to have your information complete — when are you planning to sell it?";
      else if (explainMethod) nextQ = "With a direct cash sale we buy it and pay you on the spot. With consignment we sell it on your behalf at market price — usually a better return, but it takes 2–4 weeks. Which would you prefer?";
      else if (!nowHasMethod && age <= 8) nextQ = "Would you like to sell it for direct cash, or with consignment?";
      else if (!phoneAskedBefore) nextQ = PHONE_Q;

      const parts: string[] = [];
      if (firstTime) parts.push("Thanks for letting me know. Whether we can buy non-GCC cars depends on the specific car and its condition. I'll have someone from our purchasing team reach out to you directly.");
      parts.push(nextQ ?? "Thanks, I've got everything I need. Our team will be in touch shortly. Have a nice day!");

      for (const part of parts) await sendWhatsAppMessage(phone, part);
      if (!nextQ) updates.step = CLOSING_STEP;
      await updateConversation(phone, updates as any).catch(e => console.error("non-GCC save error:", e));
      await appendHistory(phone, hist, messageText, parts.join("\n\n"));

      // Push at the handoff (so the team sees it right away) and again when complete
      if (firstTime || !nextQ) await pushLead(phone, firstTime ? "non-GCC handoff" : "non-GCC complete", { salesInquiry: nowHasMethod ? undefined : "Other", inspectionBooked: false });
      return NextResponse.json({ status: "non_gcc_handoff" }, { status: 200 });
    }

    if (Array.isArray(vehicleUpdates.typo_check) && vehicleUpdates.typo_check.length > 0) {
      for (const tc of vehicleUpdates.typo_check) {
        if (tc.field === "model" && (!vehicleUpdates.model || vehicleUpdates.model === "Unknown")) {
          vehicleUpdates.model = tc.suggestion;
          console.log(`[kaya] typo auto-corrected: model "${tc.input}" → "${tc.suggestion}"`);
        }
        if (tc.field === "make" && (!vehicleUpdates.make || vehicleUpdates.make === "Unknown")) {
          vehicleUpdates.make = tc.suggestion;
          console.log(`[kaya] typo auto-corrected: make "${tc.input}" → "${tc.suggestion}"`);
        }
      }
      vehicleUpdates.typo_check = [];
    }

    const hasModel = !!(vehicleUpdates.make ?? conversation.make) && !!(
      (vehicleUpdates.model && vehicleUpdates.model !== "Unknown") ||
      (conversation.model   && conversation.model   !== "Unknown")
    );
    const hasYear  = !!(vehicleUpdates.year ?? conversation.year);
    const hasSpecs = !!carSpecs || specsExplicitlyUnknown || conversation.specs === "Unknown";

    // Customer gave model, year, mileage AND specs at step 3 → skip the mileage step
    const isCarStep     = currentStep === 2 || currentStep === 3;
    const step3Complete = isCarStep && hasModel && hasYear && !!carMileage && hasSpecs;
    // Booking requested and the car is identified → go straight to booking (step 7)
    const jumpToBooking = (wantsBooking && hasModel && hasYear) || isRebook;
    const step3OldCar   = step3Complete && carYear > 0 && (currentYear - carYear) >= 10;

    let action: NextAction | undefined;

    if (currentStep === 1 && GREETING_ONLY.test(messageText)) {
      action = { type: "ASK_NAME" };
    } else if (jumpToBooking) {
      action = undefined; // Kaya handles booking with the step-7 instruction
    } else if (isCarStep) {
      if (!hasModel || !hasYear) {
        action = { type: "ASK_CAR_DETAILS" };
      } else if (step3Complete) {
        action = step3OldCar ? { type: "SHOW_SUMMARY" } : { type: "ASK_MORTGAGE" };
      } else {
        action = { type: "ASK_MILEAGE_SPECS" };
      }
    } else if (currentStep === 4) {
      if (!hasModel || !hasYear) {
        action = { type: "CLARIFY_MODEL" };
      } else if (!carMileage) {
        action = { type: "ASK_MILEAGE_SPECS" };
      } else if (!hasSpecs) {
        action = { type: "ASK_SPECS" };
      } else if (skipLoan) {
        action = { type: "SHOW_SUMMARY" };
      } else {
        action = { type: "ASK_MORTGAGE" };
      }
    } else if (currentStep === 5 && loanIsYes && !mortgageAmount && !conversation.mortgage_amount) {
      action = { type: "ASK_AMOUNT" };
    } else if (currentStep === 5) {
      action = { type: "SHOW_FULL_SUMMARY" };
    }

    const history: ConversationMessage[] = (conversation.messages ?? []) as ConversationMessage[];
    const PRICE_PUSH      = /\b(price|offer|estimate|range|how much|what.*(worth|pay|give)|give me.*price|tell me.*price)\b/i;
    const HUMAN_REQUEST   = /\b(call me|(speak|talk)\s+(to|with)\s+(a\s+)?(someone|somebody|person|human|agent|manager|staff|team)|real person|human agent)\b/i;
    const BOOKING_REFUSAL = /\b(no\s*,?\s*thanks?|no\s*,?\s*thank\s*you|not\s*interested|maybe\s*later|i'?ll\s*pass|don'?t\s*want\s*(to|it)|forget\s*it|not\s*for\s*me|leave\s*it|never\s*mind|nevermind|bye|goodbye)\b/i;
    const OPTIONS_SENT = /consignment|direct cash sale|we can advise after/i;
    const alreadyExplainedOptions = history.some(
      m => m.role === "assistant" && OPTIONS_SENT.test(m.content)
    );
    // How many times has the customer pushed on price?
    const pricePushCount = history.filter(
      m => m.role === "user" && PRICE_PUSH.test(m.content)
    ).length;
    const customerWantsCashOnly = /\b(cash only|only cash|just cash|cash sale|direct.*buy)\b/i.test(messageText);

    // Save sell method at step 6
    if (currentStep === 6 && messageText) {
      let sellMethod: string | undefined;
      if (SELL_METHOD_CASH.test(messageText))        sellMethod = "cash";
      else if (SELL_METHOD_CONSIGNMENT.test(messageText)) sellMethod = "consignment";
      else if (SELL_METHOD_NOT_SURE.test(messageText))    sellMethod = "not_sure";
      if (sellMethod) {
        try {
          await updateConversation(phone, { sell_timeline: `sell_method:${sellMethod}` } as any);
        } catch (e) {
          console.error("sell method save error (non-fatal):", e);
        }
      }
    }

    // Handoff trigger — complex conversations get forwarded to purchase team
    const handoffSignal =
      HUMAN_REQUEST.test(messageText) ||
      (currentStep >= 6 && HANDOFF_SIGNALS.test(messageText)) ||
      // Only callback if consignment was already suggested and they still refuse
      (alreadyExplainedOptions && BOOKING_REFUSAL.test(messageText)) ||
      (alreadyExplainedOptions && customerWantsCashOnly && BOOKING_REFUSAL.test(messageText));

    // If customer pushes on price a second time (and consignment not yet explained) → let Claude pivot to consignment
    // If customer gives up / not interested after consignment was explained → offer callback
    const callbackSignal = handoffSignal;
    if (!action && currentStep >= 5 && currentStep < CLOSING_STEP && callbackSignal) {
      action = { type: "OFFER_CALLBACK" };
    }

    const estMake    = (vehicleUpdates.make  ?? conversation.make)  ?? "";
    const estModel   = (vehicleUpdates.model ?? conversation.model) ?? "";
    const estYear    = (vehicleUpdates.year  ?? conversation.year)  ?? "";
    const estMileage = vehicleUpdates.mileage ?? conversation.mileage;
    const estSpecs   = vehicleUpdates.specs   ?? conversation.specs;
    const valuation  = (estMake && estModel && estModel !== "Unknown" && estYear)
      ? estimateCarValue(estMake, estModel, estYear, estMileage, estSpecs)
      : null;

    // At step 0 (greeting), never pass stale vehicle data — customer is just saying hi
    const conversationForFields = currentStep === 0
      ? { ...conversation, make: null, model: null, year: null, mileage: null, specs: null, car: null, loan: null, mortgage_amount: null, sell_timeline: null }
      : conversation;

    const knownFields = {
      ...conversationForFields,
      ...coreUpdates,
      ...vehicleUpdates,
      image_shared: isImageMessage || undefined,
      sell_timeline:    sellTimeline,
      sell_urgent:      sellUrgent,
      dubai_hour:       getDubaiHour(),
      dubai_datetime:   getDubaiDateTime(),
      dubai_tomorrow:   getDubaiTomorrow(),
      booking_slot:     getBookingSlot(),
      rebooking:        isRebook ? `Customer is RESCHEDULING an existing booking (was: ${conversation.appointment_date ?? "?"} ${conversation.appointment_time ?? ""}). Confirm the new date/time and send the confirmation. Do NOT ask for name or number again.` : undefined,
      mortgage_amount:  mortgageAmount ?? conversation.mortgage_amount,
      skip_mortgage:    hasAllVehicleFields && carYear > 0 && (currentYear - carYear) >= 10,
      estimated_value:  valuation?.formatted ?? null,
      next_action:      action ? describeAction(action) : undefined,
      appointment_date: apptDate || conversation.appointment_date || undefined,
      appointment_time: apptTime || conversation.appointment_time || undefined,
    };

    console.log(`[kaya] step=${currentStep} action=${action?.type ?? "none"}`);

    const reply = action
      ? buildDirectResponse(action, (knownFields.name ?? conversation.name) as string | null, knownFields)
      : await getKayaReply(jumpToBooking ? FINAL_STEP : currentStep, history, messageText, knownFields);

    // Don't depend on one exact sentence — Kaya words it differently. Confirmed if a date AND
    // time were captured and the reply reads like a confirmation.
    const hasApptDateTime = !!(apptDate || conversation.appointment_date) && !!(apptTime || conversation.appointment_time);
    const appointmentConfirmedEarly = (currentStep === FINAL_STEP || jumpToBooking) && !action && (
      /team will be in touch on whatsapp/i.test(reply) ||
      (hasApptDateTime && /\b(all set|you'?re set|booked|confirmed|see you|it'?s set|locked in|in touch)\b/i.test(reply))
    );

    const replyParts = reply.split(/\[SPLIT\]/i).map(s => s.trim()).filter(Boolean);
    if (appointmentConfirmedEarly && replyParts.length > 0) {
      replyParts[replyParts.length - 1] += "\n\nHere below is our location.";
    }
    for (const part of replyParts) {
      await sendWhatsAppMessage(phone, part);
    }

    if (appointmentConfirmedEarly) {
      await sendWhatsAppImage(phone, LOCATION_IMAGE_URL);
      await sendWhatsAppMessage(phone, LOCATION_TEXT);
    }

    if (action?.type === "OFFER_CALLBACK") {
      await sendWhatsAppMessage(phone, "Our purchase team will be in touch with you shortly. You're also welcome to walk in whenever — here's where to find us.");
      await sendWhatsAppImage(phone, LOCATION_IMAGE_URL);
      await sendWhatsAppMessage(phone, LOCATION_TEXT);
    }

    try {
      const updatedHistory: ConversationMessage[] = [
        ...history,
        { role: "user"      as const, content: messageText },
        { role: "assistant" as const, content: reply },
      ].slice(-40);
      await updateConversation(phone, { messages: updatedHistory } as any);
    } catch (e) {
      console.error("history save error (non-fatal):", e);
    }

    const appointmentConfirmed = appointmentConfirmedEarly;

    const stayAtStep1        = false; // never wait for the name — move on to the car
    const stayAtMileageSpecs = currentStep === 4 && !hasAllVehicleFields;
    const stayAtLoanAmount   = currentStep === 5 && loanIsYes
      && !mortgageAmount && !conversation.mortgage_amount;
    const stayAtAppointment  = (currentStep === FINAL_STEP || jumpToBooking) && !appointmentConfirmed;
    // At step 6 (sell method), only stay if they asked for explanation (not sure / explain)
    // — otherwise advance to appointment booking
    const stayAtSellMethod   = currentStep === 6 && SELL_METHOD_NOT_SURE.test(messageText)
      && !SELL_METHOD_CASH.test(messageText) && !SELL_METHOD_CONSIGNMENT.test(messageText);
    const nextStep = currentStep >= CLOSING_STEP ? (isRebook && !appointmentConfirmed ? FINAL_STEP : CLOSING_STEP)
      : (jumpToBooking && appointmentConfirmed) ? CLOSING_STEP
      : stayAtStep1        ? 1
      : stayAtMileageSpecs ? 4
      : stayAtLoanAmount   ? 5
      : stayAtSellMethod   ? 6
      : stayAtAppointment  ? FINAL_STEP
      : skipLoan           ? 6
      : step3OldCar        ? 6
      : step3Complete      ? 5
      : (currentStep === 2 && hasModel && hasYear) ? 4
      : currentStep + 1;
    coreUpdates.step = nextStep;
    const updatedConversation = await updateConversation(phone, coreUpdates);

    if (Object.keys(vehicleDbFields(vehicleUpdates)).length > 0) {
      try {
        await updateConversation(phone, vehicleDbFields(vehicleUpdates));
      } catch (e) {
        console.error("vehicleUpdates save error (non-fatal):", e);
      }
    }

    if (valuation?.formatted) {
      try {
        await updateConversation(phone, { estimated_price: valuation.formatted } as any);
      } catch (e) {
        console.error("estimated_price save error (non-fatal):", e);
      }
    }

    if (mortgageAmount) {
      try {
        await updateConversation(phone, { mortgage_amount: mortgageAmount });
      } catch (e) {
        console.error("mortgageAmount save error (non-fatal):", e);
      }
    }

    // ── Bigin milestones ──────────────────────────────────────────────
    // a) booking confirmed  b) team follow-up promised (callback, cash-only, price handoff …)
    const TEAM_FOLLOWUP = /\b(team|someone)\b[^.]{0,60}\b(be in touch|reach out|call you|contact you|get back to you|follow up)/i;
    const teamFollowUp = !appointmentConfirmed &&
      (action?.type === "OFFER_CALLBACK" || TEAM_FOLLOWUP.test(reply));

    if (appointmentConfirmed) {
      const sellTl = (await getConversation(phone).catch(() => null))?.sell_timeline ?? "";
      const salesInquiry = sellTl.includes("consignment") ? "Consignment"
        : sellTl.includes("cash") ? "Cash Deal" : "Not Sure - Need Advise";
      await pushLead(phone, "booking confirmed", { salesInquiry, inspectionBooked: true, altPhone });
    } else if (teamFollowUp) {
      await pushLead(phone, "team follow-up", { salesInquiry: pricePushCount > 0 || PRICE_PUSH.test(messageText) ? "Price Offer Inquiry" : undefined });
    }

    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch (error) {
    console.error("Webhook POST error:", error);
    return NextResponse.json({ status: "error" }, { status: 200 });
  }
}
