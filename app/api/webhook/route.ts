import {mileageClarification} from "@/lib/kaya-improve/policy-checks";
import {LOCATION_TEXT,CUSTOMER_CALL_CHOICE,wantsOurNumber} from "@/lib/kaya-improve/contact";
import { saveInbound } from "@/lib/inbound";
import { learnedMessage } from "@/lib/kaya-improve/learning";
import { NextRequest, NextResponse } from "next/server";
import { getOrCreateConversation, updateConversation, resetConversation, getConversation, Conversation } from "@/lib/supabase";
import { pickDefaultTime } from "@/lib/slots";
import { classifyTiming } from "@/lib/timing";
import { SAFE_PRICE_REPLY, getKayaReply, wantsHuman, extractVehicleInfo, extractAppointment, generateInquirySummary, VehicleFields, ConversationMessage } from "@/lib/claude";
import { sendWhatsAppMessage, sendWhatsAppImage, sendTypingIndicator } from "@/lib/meta";
import { createBiginContact, createChangeTask, moveLeadToCallBack, toIsoDate, toTime24 } from "@/lib/bigin";
import { CAR_MODELS, CAR_MAKES } from "@/lib/carData";
import { estimateCarValue } from "@/lib/valuation";
import { MULKIYA_QUESTION, mulkiyaAnswer, specsStatement } from "@/lib/specs";
import { asksBestWayToSell, isSellingOptionAnswer, isStandaloneOffTopicQuestion } from "@/lib/topic";
import { visitAvailability } from "@/lib/availability";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RESET_KEYWORD = "reset chat 007";

const LOCATION_KEYWORDS = /\b(location|address|where are you|where is|how to get|directions?|map|find you|your office|office location|come to you)\b/i;

const LOCATION_IMAGE_URL = ""; // add outside branch photo as public/location.jpg, then set "https://mw-whatsapp2.vercel.app/location.jpg"



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
const POST_NAME_Q  = "May I have your name for the booking?";
const POST_PHONE_Q = "Which number is best to reach you on?";
const CLOSING_STEP = 8;
const BOOKING_OR_TEAM_CHOICE = "Would you like to continue with the booking, or shall I forward your details to our purchasing team so they can discuss it with you by phone?";
const NOT_READY_CHOICE = "No problem. Would you like someone from our team to contact you personally to discuss your car?";


// The customer asking for OUR number is not a request for US to call them.


// Sell method detection
const SELL_METHOD_CASH        = /\b(cash|direct|buy now|sell now|sell fast|quick sale|immediately|instant)\b/i;
const SELL_METHOD_CONSIGNMENT = /\b(consign|consignment|list|listing|display|market|higher price|best price)\b/i;
const SELL_METHOD_NOT_SURE    = /\b(not sure|unsure|don.?t know|undecided|still deciding|what.?s better|which is better|explain|difference|options?)\b/i;

// Handoff detection — complex conversations that need a human
// Explicit asks for a person only. Questions like "how does it work?" are answered by Kaya.
const HANDOFF_SIGNALS = /\b(too many questions|call me(?=\s*(back|later|please|pls|now|asap|tomorrow|today|on|at|when|$|[.!?]))|(speak|talk)\s+(to|with)\s+(a\s+)?(someone|somebody|person|human|agent|manager|team)|real person|human agent)\b/i;

// Special inquiry types
const HOME_VISIT_PATTERN  = /\b(home\s*(visit|pick\s*up|collection|pickup)|come\s*to\s*(me|my|us)|pick\s*(it\s*)?up|collect\s*(from|at)|i\s*can.?t\s*(come|bring)|unable\s*to\s*(come|drive|bring)|mobility|wheelchair|disabled)\b/i;
const TRADE_IN_PATTERN    = /\b(trade[\s-]?in|trade\s*my|swap|exchange|part[\s-]?exchange|replace\s*(my|the)|get\s*(a\s*)?new\s*car|upgrade\s*(my|the)|in\s*exchange\s*for)\b/i;
const DEFER_PATTERN = /\b(let (u|you) know|(will|i'?ll|i will) (inform|tell|update|confirm|revert|message|text|call)( (u|you))?|get back to (u|you)|i'?ll (check|think|see|decide)|will (check|think|decide)|think about it|not sure yet|let me (check|think|see)|(i'?ll |i will |will )?confirm (to )?(you |u )?(later|tomorrow|the date|date|time|timing)|later i (will |'ll )?(confirm|tell|inform|let)|i confirm (to )?(you |u )?later|date i confirm)\b/i;
const PRICE_OFFER_PATTERN = /\b(how\s*much|price|offer|estimate|valuation|value|worth|ballpark|rough\s*(range|figure|number|quote|idea)|what\s*(will\s*you\s*pay|do\s*you\s*give|can\s*i\s*get)|(?:can|will|would)\s*you\s*(pay|give|match|beat)|(?:give|tell)\s*me\s*(a\s*)?(price|number|figure|quote))\b/i;

// Ownership detection
const OWNER_PATTERN = /\b(my\s*car|i\s*(own|am\s*the\s*owner)|registered\s*(in\s*my\s*name|owner)|it.?s\s*mine)\b/i;
const POA_PATTERN   = /\b(poa|power\s*of\s*attorney|selling\s*for|on\s*behalf|not\s*my\s*car|friend.?s\s*car|family.?s\s*car|brother.?s|sister.?s|father.?s|mother.?s|husband.?s|wife.?s)\b/i;

// Car condition signals — extract when mentioned
const CONDITION_PATTERN = /\b(accident|damage|damaged|dent|scratch|flood|fire|total\s*loss|write[\s-]?off|modified|modification|tuned|engine|gearbox|transmission|service|fine|fines|traffic\s*fine|salik|document|registration|mulkiya|expired|missing|lost|stolen|bank\s*loan|finance|mortgage)\b/i;

// Insult detection
// Real abuse only. Objections ("is this a scam?", "rubbish prices", "terrible offers") are NOT insults —
// Kaya handles those as normal objections.
// Abuse aimed at Kaya/us only — frustrated swearing ("this is f***ing slow") is not an insult.
const INSULT_PATTERN = /\b(you(\s+are|'re|re|r)?\s+(an?\s+|so\s+|such\s+an?\s+)?(stupid|idiot|dumb|moron|useless|retard\w*|asshole|bastard|bitch|dickhead|clown)|(fuck|f\*+k|screw)\s*(you|u|off|ur)|stfu|shut\s*up|son of a bitch|motherfucker|(stupid|idiot|dumb|useless|retarded)\s+(bot|ai|assistant|girl|company|people)|^\s*(idiot|stupid|moron|asshole|bitch|bastard)\s*[!.]*\s*$)/i;

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

// Words that are never a name: car makes/models, greetings, common replies
const CAR_WORDS = new Set<string>([
  ...Object.keys(CAR_MAKES), ...Object.values(CAR_MAKES), ...Object.values(CAR_MODELS).flat(),
  "merc", "benz", "mercedes", "chevy", "vw", "landcruiser", "cruiser", "rover", "range", "lexus", "beemer",
].map(w => String(w).toLowerCase()));
const NOT_A_NAME = /^(call|callback|phone|number|contact|ring|hi+|hey+|hello+|hiya|yo|salam|salaam|assalam\w*|good|morning|afternoon|evening|there|yes|yeah|yep|no|nope|ok|okay|sure|thanks|thank|car|cars|selling|sell|sale|buy|price|offer|cash|consignment|interested|looking|here|fine|my|the|a|an|it|its|is|not|just|want|need|please|today|tomorrow|now|asap|gcc|non|km|kms|loan|mortgage|new|used|old|and|from|with|but|or|im|i|am|have|has|got|to|for|in|at|on|calling|writing|messaging|busy|abroad|outside|away|late|sorry|available|ready|interested|owner|seller|buyer|dealer|agent|still|also|very|so|really|too|back|out|done|free|happy|currently|actually|based|travelling|traveling|driving|working|planning|going|thinking|trying|coming|leaving|moving|relocating|selling|asking|wondering|checking|following|sending|ignore|rules|rule|instructions|instruction|give|tell|system|prompt|forget|pretend|admin|developer|your|me|you|price|offer|bot|ai|test|kaya|kaia|mister|wheelz|full|fully|automatic|aromatic|automatik|auto|manual|gear|petrol|diesel|hybrid|electric|korean|japanese|chinese|american|german|european|canadian|spec|specs|model|runs|running|mileage|kilometers|kilometres|lakh|lakhs|accident|paint|original|clean|scrap|expired|mulkia|mulkiya|warranty|service|fines|registered)$/i;

function looksLikeName(candidate: string, explicit = false): boolean {
  const words = candidate.trim().split(/\s+/);
  if (words.some(w => NOT_A_NAME.test(w) || CAR_WORDS.has(w.toLowerCase()) || /\d/.test(w) || (!explicit && w.length > 4 && /ing$/i.test(w)))) return false;
  if (CAR_WORDS.has(candidate.trim().toLowerCase())) return false;
  return true;
}

// Dubai time-of-day words (Marc): greeting and goodbye follow the clock
function dubaiHourNow(): number { return new Date(Date.now() + 4 * 3600e3).getUTCHours(); }
function timeGreeting(): string { const h = dubaiHourNow(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; }
// Goodbye after a booking: same day → "See you later", tomorrow → "See you tomorrow", later → "Have a nice day/evening"
function bookingGoodbye(name: string | null | undefined, apptIso: string | null | undefined): string {
  const nm = firstName(name);
  const today = new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 28 * 3600e3).toISOString().slice(0, 10);
  if (apptIso === today) return `See you later${nm}!`;
  if (apptIso === tomorrow) return `See you tomorrow${nm}!`;
  return `Have a nice ${dubaiHourNow() >= 17 ? "evening" : "day"}${nm}!`;
}

// ", Benny" for the goodbye only — first name, never the last name
function firstName(n: string | null | undefined): string {
  void n; return ""; // Marc: the name is used once only ("Hi Marc!") — never in goodbyes
}

// "SUNIL" / "sunil" → "Sunil" (mixed case like "McKenzie" is kept)
function nameCase(n: string): string {
  const base = n === n.toUpperCase() || n === n.toLowerCase() ? n.toLowerCase() : n;
  return base.replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractNameFromMessage(text: string): string | null {
  const m = text.match(
    /(?:i'?m\s+|i\s+am\s+|my\s+name(?:\s+is)?\s+|this\s+is\s+|name\s+is\s+|call\s+me\s+)([A-Za-z][a-z]*(?:\s+[A-Za-z][a-z]*){0,3})/i
  );
  if (m) {
    // "my name is / call me / name is" = explicit → trust names like "Sterling"
    const explicit = /my\s+name|name\s+is|call\s+me/i.test(m[0]);
    // keep only the leading name-like words ("Omar selling" → "Omar")
    const all = m[1].trim().split(/\s+/);
    let k = 0; while (k < all.length && looksLikeName(all.slice(0, k + 1).join(" "), explicit)) k++;
    const nm = all.slice(0, k).join(" ");
    return nm ? nameCase(nm) : null;
  }
  const trimmed = text.trim();
  if (/^[A-Za-z]+(?:\s+[A-Za-z]+){0,3}$/.test(trimmed) && trimmed.length <= 40 && looksLikeName(trimmed))
    return nameCase(trimmed);
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

// Day for a booking when the customer only gave a time. Follows Kaya's question
// ("today / this afternoon" → today, "tomorrow" → next open day); if unclear, today when the slot
// is still ahead and within hours, otherwise the next open day. Never a Sunday.
function inferApptDate(t24: string, lastQuestion: string): string | null {
  const now = new Date(Date.now() + 4 * 3600e3);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const mins = +t24.slice(0, 2) * 60 + +t24.slice(3);
  const fitsDay = (d: Date) => {
    const dow = d.getUTCDay();
    if (dow === 0) return false;
    const openM = dow === 5 ? 12 * 60 : 10 * 60;
    return mins >= openM && mins <= 18 * 60 + 30;
  };
  const nextOpen = () => {
    const d = new Date(now);
    do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() === 0);
    return d;
  };
  const todayOk = fitsDay(now) && mins > now.getUTCHours() * 60 + now.getUTCMinutes();
  const q = lastQuestion.toLowerCase();
  const saysToday = /\b(today|this (morning|afternoon|evening))\b/.test(q);
  const saysTomorrow = /\btomorrow\b/.test(q);
  if (saysTomorrow && !saysToday) return iso(nextOpen());
  if (todayOk) return iso(now);
  const n = nextOpen();
  return fitsDay(n) ? iso(n) : null;
}

// Customer name when the name field was never filled: the answer to Kaya's name question.
function nameFromHistory(history: ConversationMessage[]): string | null {
  for (let i = 0; i < history.length - 1; i++) {
    const a = history[i], u = history[i + 1];
    if (a.role === "assistant" && u.role === "user" && /\b(your name|may i (know|have) your name|who am i speaking)\b/i.test(a.content)) {
      const n = extractNameFromMessage(u.content);
      if (n) return n;
    }
  }
  for (const m of history) {
    if (m.role !== "user") continue;
    const here = m.content.match(/^\s*(?:(?:hi|hello|hey|salam)[,!.\s]+)?([A-Za-z][a-z]{1,15})\s+here\b/i);
    if (here) { const n = extractNameFromMessage(here[1]); if (n) return n; }
    const mm = m.content.match(/\b(?:my name is|i am|i'm|this is|it's)\s+([A-Za-z][a-z]+)/i);
    if (mm) { const n = extractNameFromMessage(mm[1]); if (n) return n; }
  }
  return null;
}

// ── Bigin push — one path for every milestone ───────────────────────────────
// Called on: booking confirmed, team follow-up / handoff, and (from the cron) 12-min silence.
// Bigin upserts by phone, so pushing more than once just updates the same contact.
async function pushLead(
  phone: string,
  reason: string,
  opts: { salesInquiry?: string; inspectionBooked?: boolean; altPhone?: string; clearAppointment?: boolean;
          topNote?: string;
          // Milestone → new record in Bigin; red tag if the customer already exists there
          milestone?: "DUPLICATE" | "RESCHEDULE" | "CANCEL" | "FOLLOW UP" } = {}
): Promise<void> {
  try {
    const latest = await getConversation(phone);
    if (!latest) return;
    const history: ConversationMessage[] = Array.isArray(latest.messages) ? latest.messages : [];
    // Never push the car as the contact name when the customer did give their name
    if (!latest.name) {
      const n = nameFromHistory(history);
      if (n) { latest.name = n; await updateConversation(phone, { name: n } as any).catch(() => {}); }
    }
    const aiSummary = await generateInquirySummary(history, latest as any).catch(() => "");
    const notesAll = String((latest as any).car_conditions ?? "");
    const otherCars = notesAll.split(" | ").filter(n => /^(Other car|Also selling|Cars):/.test(n));
    const buyerNote = [
      /BUYER:/.test(notesAll) ? "BUYER — wants to buy a car, not selling." : /Trade-in:/.test(notesAll) ? "TRADE-IN — customer also wants to buy a car." : "",
      /OPTED OUT:/.test(notesAll) ? "OPTED OUT — customer asked not to be messaged. Do not contact." : "",
      /NOT READY YET/.test(notesAll) ? `NOT READY YET — ${/Declined personal call/.test(notesAll) ? "customer declined a call; do not call." : /Accepted personal call/.test(notesAll) ? "customer requested a personal call." : "call preference pending."}` : "",
      /Prefers WhatsApp/.test(notesAll) ? "Prefers WhatsApp — no phone calls." : "",
      /HIYAZA:/.test(notesAll) ? "HIYAZA ONLY — no plates/insurance, no appointment booked." : "",
      /TRUCK\/BUS:/.test(notesAll) ? "TRUCK / BUS — needs filtering by the team, no appointment booked." : "",
      notesAll.match(/Customer expects: AED [\d,]+/)?.[0] ?? "",
      notesAll.match(/Competitor offer \(customer says, unverified\): [^|]+/)?.[0]?.trim() ?? "",
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
    case "ASK_NAME":         return `Greet by time of day (Good morning/afternoon/evening), then ask: "What car would you like to sell?"`;
    case "ASK_UAE_PHONE":    return "Ask: \"On which UAE number can we reach you on?\"";
    case "ASK_CAR_DETAILS":  return "Ask for the car make, model and year.";
    case "ASK_MILEAGE_SPECS":return "Ask for BOTH the mileage AND whether the car is GCC or non-GCC specs — in one question.";
    case "ASK_SPECS":        return `Ask ONLY: "GCC specs, right?" — nothing else, no repeating what they said.`;
    case "ASK_MORTGAGE":     return `Ask: "Any loan on the car?"`;
    case "ASK_AMOUNT":       return `Ask: "How much is the outstanding balance?"`;
    case "CLARIFY_MODEL":    return `Ask ONLY for what is still missing — the model and/or the year (check "What you already know") — in a few words, e.g. "Which year is it?". Never ask to "confirm" something they already gave.`;
    case "SHOW_SUMMARY":      return `Ask: "When would you like to sell?"`;
    case "SHOW_FULL_SUMMARY": return `Ask: "When would you like to sell?"`;
    case "OFFER_CALLBACK":   return `Tell the customer the purchasing team will call them ${teamWhen()}, and they're welcome to come in whenever.`;
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
        return `${greet}! What car would you like to sell?`;
      }
    case "ASK_UAE_PHONE":
      return `Which UAE number is best to reach you on?`;
    case "ASK_CAR_DETAILS": {
      const hasMake  = !!(known.make  && known.make  !== "Unknown");
      const hasModel = !!(known.model && known.model !== "Unknown");
      const hasYear  = !!known.year;
      if (hasMake && hasModel) {
        return `Which year?`;
      } else if (hasMake && hasYear) {
        return `Nice! Which model is it?`;
      } else if (hasMake) {
        return `Nice! What's the model and year?`;
      }
      return `Which make, model and year?`;
    }
    case "ASK_MILEAGE_SPECS": {
      const hasSpecs   = !!(known.specs && known.specs !== "Unknown");
      const hasMileage = !!known.mileage;
      if (hasSpecs && !hasMileage) return `What's the mileage on it?`;
      if (hasMileage && !hasSpecs) return `Thanks! GCC specs, right?`;
      return `Mileage, and GCC specs?`;
    }
    case "ASK_SPECS":
      return `Thanks! GCC specs, right?`;
    case "ASK_MORTGAGE":
      return "Any loan on the car?";
    case "ASK_AMOUNT":
      return "How much is the outstanding balance?";
    case "CLARIFY_MODEL": {
      const hasModel = !!(known.model && known.model !== "Unknown");
      return hasModel && !known.year ? "Which year?" : !hasModel && known.year ? "Which model is it exactly?" : "Which model and year is it?";
    }
    case "SHOW_SUMMARY":
    case "SHOW_FULL_SUMMARY":
      return "When would you like to sell?";
    case "OFFER_CALLBACK":
      return `Ok, I understand. I will forward this to our team and have them contact you so you can discuss it with them directly.`;
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
  // Branch closed right now (Marc: say we're closed, when we open, then ask for a time)
  const openToday = OPEN[now.getUTCDay()];
  const ampm = (h: number) => (h === 12 ? "12 PM" : h > 12 ? `${h - 12} PM` : `${h} AM`);
  const closedNow = openToday == null || mins >= 19 * 60 || mins < openToday * 60;
  const opensLabel = openToday != null && mins < openToday * 60 ? "today" : nextLabel;
  const opensAt = openToday != null && mins < openToday * 60 ? openToday : Number(nextFull.match(/opens (\d+)/)?.[1] ?? 10);
  const question = closedNow ? `We're closed right now, but I can book an inspection for you ${opensLabel} after ${ampm(opensAt)}. What time is best for you to bring the car?`
    : !todayOpen ? `What time can you come in ${nextLabel}?`
    : offerNextToo ? `What time can you come in ${todayWord} or ${nextLabel}?`
    : `What time can you come in ${todayWord}?`;
  return `Ask exactly: "${question}" — always ask for a TIME, never a yes/no question. ` +
    (todayOpen ? `Branch is open today until 19:00 (last slot 18:30). ` : `Too late for today. Do NOT hand off to the team. `) +
    `Next opening day: ${nextFull}.`;
}

// When the team will contact the customer: "shortly" while open, otherwise the next opening morning.
// Customer wants Sunday (closed) — the context is Sunday, not whether we're open right now (Marc):
// today Friday → Saturday only · today Saturday → open again Monday · otherwise Friday or Saturday
function appointmentConfirmedEarlyGuard(_d: string, _t: string): boolean { return false; }

// The booking question Kaya asked last ("What time can you come in this afternoon?") — to pick up where
// we left off after a side question (location, price), instead of starting a new "which day" question
// "Tuesday 10 am" said on a Tuesday after 10 am (or the customer said "next week") means NEXT Tuesday
function rollSameWeekday(iso: string | null, text: string, timeRaw: string, userHistory: string[]): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const nowD = new Date(Date.now() + 4 * 3600e3);
  const todayIso = nowD.toISOString().slice(0, 10);
  // Customer talked about "next week" (recently) and now names just a weekday → that weekday NEXT week
  {
    const recent = [...userHistory.slice(-3), text];
    const wdOnly = /\b(monday|tuesday|wednesday|thursday|friday|saturday)\b/i.test(text) && !/\b\d{1,2}(st|nd|rd|th)?\s*(of\s*)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\b(this|tomorrow|today)\b/i.test(text);
    const dow = nowD.getUTCDay();
    const nextMon = new Date(Date.parse(todayIso + "T12:00:00Z") + ((((8 - dow) % 7) || 7) * 86400e3)).toISOString().slice(0, 10);
    if (wdOnly && recent.some(t => /\bnext week\b/i.test(t)) && iso < nextMon) {
      return new Date(Date.parse(iso + "T12:00:00Z") + 7 * 86400e3).toISOString().slice(0, 10);
    }
  }
  if (iso !== todayIso) return iso;
  const todayName = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"][nowD.getUTCDay()];
  if (!new RegExp(`\\b${todayName}\\b`, "i").test(text) || /\b(today|tonight|now|this (morning|afternoon|evening))\b/i.test(text)) return iso;
  const nowMin = nowD.getUTCHours() * 60 + nowD.getUTCMinutes();
  const t24 = toTime24(timeRaw || "");
  const passed = t24 ? +t24.slice(0, 2) * 60 + +t24.slice(3) <= nowMin + 30 : nowMin >= 17 * 60;
  const nextWeekCtx = [...userHistory, text].some(t => /\bnext week\b/i.test(t));
  return passed || nextWeekCtx ? new Date(Date.parse(todayIso + "T12:00:00Z") + 7 * 86400e3).toISOString().slice(0, 10) : iso;
}

function pendingBookingQ(lastAssistant: string): string | null {
  const qs = lastAssistant.split(/\n+|\[SPLIT\]|(?<=[.!?])\s+/).map(x => x.trim()).filter(x => /\?\s*$/.test(x));
  const q = [...qs].reverse().find(x => /\b(shall i book you|what time|which day|which time|when would you like to (come|bring)|would .+ or .+ work)\b/i.test(x));
  return q ?? null;
}

function sundayText(): string {
  const dow = new Date(Date.now() + 4 * 3600e3).getUTCDay();
  if (dow === 5) return "Sorry, we're closed on Sundays. We're open on Saturday from 10 AM to 7 PM. Would Saturday work for you?";
  if (dow === 6) return "Sorry, we're closed on Sundays. We're open again on Monday from 10 AM to 7 PM. Would Monday work for you?";
  return "Sorry, we're closed on Sundays. We're open on Friday from 12 PM to 7 PM and on Saturday from 10 AM to 7 PM. Which day works best for you?";
}

function teamWhen(): string {
  const OPEN: Record<number, number | null> = { 0: null, 1: 10, 2: 10, 3: 10, 4: 10, 5: 12, 6: 10 };
  const now = new Date(Date.now() + 4 * 60 * 60 * 1000);
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const todayOpen = OPEN[now.getUTCDay()];
  if (todayOpen != null && mins >= todayOpen * 60 && mins < 18 * 60 + 30) return "shortly";
  if (todayOpen != null && mins < todayOpen * 60) return todayOpen === 12 ? "today from 12:00" : "this morning";
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now.getTime() + i * 86400000);
    const open = OPEN[d.getUTCDay()];
    if (open == null) continue;
    const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    const day = i === 1 ? "tomorrow" : `on ${DAYS[d.getUTCDay()]}`;
    return open === 12 ? `${day} from 12:00` : `${day} morning`;
  }
  return "shortly";
}

// "Perfect, Ali - you're booked for\n\n*Saturday 10th of October*\nat *6:30 PM*\n\nThe Mister Wheelz team will be in touch to confirm the details."
function formatBookingConfirmation(name: string | null | undefined, dateRaw: string, timeRaw: string): string | null {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : toIsoDate(dateRaw);
  const t24 = toTime24(timeRaw);
  if (!iso || !t24) return null;
  const d = new Date(iso + "T12:00:00Z");
  const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const n = d.getUTCDate();
  const sfx = [11,12,13].includes(n) ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  const [h, m] = t24.split(":").map(Number);
  const time = `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
  return `You're booked for\n\n*${DAYS[d.getUTCDay()]} ${n}${sfx} of ${MONTHS[d.getUTCMonth()]}*\nat *${time}*\n\nThe Mister Wheelz team will be in touch to confirm the details. ${bookingGoodbye(name, iso)}`;
}

function apptLabel(dateRaw?: string | null, timeRaw?: string | null): string {
  const iso = dateRaw ? (/^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : toIsoDate(dateRaw)) : null;
  const t24 = timeRaw ? toTime24(timeRaw) : null;
  const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  let date = dateRaw ?? "";
  if (iso) {
    const d = new Date(iso + "T12:00:00Z"); const n = d.getUTCDate();
    const sfx = [11,12,13].includes(n) ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
    date = `${DAYS[d.getUTCDay()]} ${n}${sfx} of ${MONTHS[d.getUTCMonth()]}`;
  }
  let time = timeRaw ?? "";
  if (t24) { const [h, m] = t24.split(":").map(Number); time = `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; }
  return [date, time].filter(Boolean).join(" ");
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
  document?: { caption?: string; filename?: string };
  video?: { caption?: string };
  type: string;
  referral?: { source_url?: string; source_id?: string; source_type?: string; headline?: string; body?: string; ctwa_clid?: string };
}

function extractMessage(body: any): IncomingMessage | null {
  try {
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    if (!value?.messages || value.messages.length === 0) return null;
    const message = value.messages[0];
    return { from: message.from, id: message.id, text: message.text, image: message.image, document: message.document, video: message.video, type: message.type, referral: message.referral };
  } catch (error) {
    console.error("extractMessage parse error:", error);
    return null;
  }
}

// ---- POST: incoming message handler ----
export async function POST(req: NextRequest) {
  const t0 = Date.now();
  let body: any;

  try {
    body = await req.json();
  } catch (error) {
    console.error("Failed to parse webhook body:", error);
    return NextResponse.json({ status: "ignored" }, { status: 200 });
  }

  let inboundCommitted = false;
  let claimedPhone: string | null = null;   // set while this request is writing a reply
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
    let messageText = message.text?.body?.trim() ?? message.image?.caption?.trim()
      ?? message.document?.caption?.trim() ?? message.video?.caption?.trim() ?? "";

    // ── Voice notes / media without text ────────────────────────────
    if (message.type === "reaction") return NextResponse.json({ status: "ignored" }, { status: 200 });
    if (message.type === "sticker") return NextResponse.json({ status: "ignored" }, { status: 200 });
    // Commit the customer's message before Meta, Claude, or any early-return branch.
    // Keep the pre-message snapshot for restart detection and step processing below.
    const inbound = await saveInbound(phone, message.id,
      (["image", "document", "video"].includes(message.type)
        ? `[${message.type === "image" ? "photo" : "file"}]${messageText ? " " + messageText : ""}`
        : messageText || `[${message.type}]`), getOrCreateConversation, updateConversation);
    inboundCommitted = true;
    if (inbound.duplicate) return NextResponse.json({ status: "duplicate" }, { status: 200 });
    const conversation = inbound.before;
    if (!messageText && message.type === "audio") {
      await sendWhatsAppMessage(phone, "Sorry, I can't listen to voice notes. Could you type your message instead?");
      return NextResponse.json({ status: "voice_note" }, { status: 200 });
    }
    // Photos / files: Kaya can't open them. Tag them so the whole batch gets ONE reply,
    // and any caption / ad text sent with them is still read.
    const isMedia = ["image", "document", "video"].includes(message.type);
    if (isMedia) messageText = `[${message.type === "image" ? "photo" : "file"}]${messageText ? " " + messageText : ""}`;
    if (!messageText && message.type !== "text" && message.type !== "location") {
      await sendWhatsAppMessage(phone, "Thanks! Could you type your message so I can help?");
      return NextResponse.json({ status: "media_no_text" }, { status: 200 });
    }

    // ── Lead source: Click-to-WhatsApp ad (Meta adds the ad details to the first message) ──
    if (message.referral && (message.referral.source_id || message.referral.headline || message.referral.source_url)) {
      try {
        const r = message.referral;
        const ref = { source_type: r.source_type, source_id: r.source_id, headline: r.headline?.slice(0, 120), body: r.body?.slice(0, 200), source_url: r.source_url, ctwa_clid: r.ctwa_clid };
        await getOrCreateConversation(phone);
        await updateConversation(phone, { source_url: JSON.stringify(ref) } as any);
        console.log(`[source] ${phone} came from ad ${r.source_id ?? "?"} "${r.headline ?? ""}"`);
      } catch (e) { console.warn("[source] could not save the ad referral:", e); }
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
    // "got the location, thanks" isn't a request; and never resend the pin if it was just sent (unless they ask again with "where")
    const recentA = (((LOCATION_KEYWORDS.test(messageText) ? (await getConversation(phone).catch(() => null))?.messages : null) ?? []) as ConversationMessage[]).filter(m => m.role === "assistant").slice(-3).map(m => m.content).join("\n");
    const pinSentRecently = /maps\.app\.goo\.gl|Here below is our location/i.test(recentA);
    const isLocationRequest = LOCATION_KEYWORDS.test(messageText)
      && !wantsOurNumber(messageText)
      && !/\b(got|have|received|saw|thanks for)\b.{0,15}\b(the )?(location|address|map|pin)\b/i.test(messageText)
      && (!pinSentRecently || /\bwhere\b/i.test(messageText));
    // Other parts of the message besides the location request ("where are you? and is there parking")
    const otherParts = isLocationRequest
      ? messageText.split(/[?.!\n]+|\band\b|,/i).map(p => p.trim()).filter(p => p.length > 3 && !LOCATION_KEYWORDS.test(p))
      : [];
    const hasOtherQuestion = otherParts.some(p => /\b(do|does|can|could|is|are|will|how|what|which|when|why|parking|open|hours)\b/i.test(p));
    if ((isLocationMessage || isLocationRequest) && hasOtherQuestion) {
      if (LOCATION_IMAGE_URL) await sendWhatsAppImage(phone, LOCATION_IMAGE_URL);
      await sendWhatsAppMessage(phone, LOCATION_TEXT);
      messageText = otherParts.join(". ") + " (location pin already sent — don't send it again)";
    } else if (isLocationMessage || isLocationRequest) {
      if (LOCATION_IMAGE_URL) await sendWhatsAppImage(phone, LOCATION_IMAGE_URL);
      await sendWhatsAppMessage(phone, LOCATION_TEXT);
      const convForLocation = await getOrCreateConversation(phone);
      const bookedAlready = !!(convForLocation.appointment_date && convForLocation.appointment_time);
      if ((convForLocation.step ?? 0) >= FINAL_STEP - 1 && !bookedAlready) {
        // Location only → ask the DAY (Marc); "send location, I'll come today" → today's time question
        const lastA = [...((((convForLocation as any).messages ?? []) as ConversationMessage[]))].reverse().find(m => m.role === "assistant")?.content ?? "";
        const q = /\b(today|now|right now|asap)\b/i.test(messageText)
          ? (getBookingSlot().match(/Ask exactly: "([^"]+)"/)?.[1] ?? "What time can you come in today?")
          : (pendingBookingQ(lastA) ?? "Which day would you like to come?");
        await sendWhatsAppMessage(phone, q);
        const prev = String((convForLocation as any).car_conditions ?? "");
        const hist = ((convForLocation as any).messages ?? []) as ConversationMessage[];
        await updateConversation(phone, {
          ...(prev.includes("Asked for location") ? {} : { car_conditions: prev ? `${prev} | Asked for location` : "Asked for location" }),
          messages: [...hist, { role: "user", content: messageText }, { role: "assistant", content: `${LOCATION_TEXT}\n[SPLIT]\n${q}` }].slice(-40),
          last_message_at: new Date().toISOString(), last_msg_id: message.id,
        } as any).catch(() => {});
      }
      return NextResponse.json({ status: "location_sent" }, { status: 200 });
    }
    // ──────────────────────────────────────────────────────────────

    if (/^\[(photo|file)\]\s*$/.test(messageText)) {
      const cc = conversation as any;
      const carDone = ["make", "model", "year", "mileage"].every(k => cc[k] && cc[k] !== "Unknown");
      if (carDone) {
        const hist0 = (cc.messages ?? []) as ConversationMessage[];
        const ACK = "Thanks, I've passed the photos on to our team.";
        const lastA = [...hist0].reverse().find(m => m.role === "assistant")?.content ?? "";
        if (!hist0.slice(-6).some(m => m.role === "assistant" && m.content.includes(ACK)) && !lastA.includes(ACK)) {
          await sendWhatsAppMessage(phone, ACK);
          await appendHistory(phone, hist0, messageText, ACK);
        } else {
          await updateConversation(phone, { messages: [...hist0, { role: "user", content: messageText }].slice(-40), last_message_at: new Date().toISOString() } as any).catch(() => {});
        }
        return NextResponse.json({ status: "photos_ack" }, { status: 200 });
      }
    }

    // Stale-state guard: if step > 1 but no message history, the conversation
    // is in a corrupt/leftover state. Silently reset before continuing.
    const RE_INTRO = /^(hi+|hey+|hello+|hiya|yo|good\s*(morning|afternoon|evening|day))[\s!.,]*(?:i'?m|my\s+name\s+is|i\s+am|it'?s|this\s+is|call\s+me)?\s+[A-Za-z]+/i;
    const isReIntro = RE_INTRO.test(messageText);
    const isStaleNoHistory = (conversation.step ?? 0) > 1 && (!Array.isArray(conversation.messages) || conversation.messages.length === 0);
    const hoursSinceLast = conversation.last_message_at ? (Date.now() - Date.parse(conversation.last_message_at)) / 3.6e6 : 0;
    // Greeting + name after 12h+ silence (mid-flow), or ANY message 24h+ after a closed chat → new inquiry.
    // (Same Bigin contact — it's matched by phone.) A "hi there" during an active chat never resets.
    const hasCarOnFile = !!(conversation.make && conversation.make !== "Unknown");
    const todayIso = new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
    const hasUpcomingAppt = !!conversation.appointment_date && /^\d{4}-\d{2}-\d{2}$/.test(String(conversation.appointment_date))
      && String(conversation.appointment_date) >= todayIso;
    const isRestart = !hasUpcomingAppt && (isStaleNoHistory && hasCarOnFile)
      || (!hasUpcomingAppt && (conversation.step ?? 0) >= 3 && isReIntro && hoursSinceLast > 12)
      || (!hasUpcomingAppt && (conversation.step ?? 0) >= CLOSING_STEP && hoursSinceLast > 24);

    // Returning customer: keep name, car, history and summary — ask if it's the same car
    if (isRestart) {
      const c = conversation as any;
      const carDesc = [c.year, c.make, c.model].filter((v: any) => v && v !== "Unknown").join(" ");
      const hi = `Welcome back${c.name ? ", " + c.name : ""}!`;
      const reply = carDesc
        ? `${hi} Last time we spoke about your ${carDesc}. Is this about the same car, or a different one?`
        : `${hi} What car would you like to sell?`;
      await sendWhatsAppMessage(phone, reply);
      const hist = (c.messages ?? []) as ConversationMessage[];
      await updateConversation(phone, {
        step: carDesc ? CLOSING_STEP : 2,            // CLOSING + the question above = waiting for same/different
        car_conditions: String(c.car_conditions ?? "").split(" | ")
          .filter((n: string) => n && !/^(OPTED OUT:|Multiple cars:|HIYAZA:|BUYER:|Asked to speak to the team|Wants to buy:|Wants to discuss:|Best time to call:)/.test(n)).join(" | ") || null,
        ...(c.appointment_date && String(c.appointment_date) < new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10)
          ? { appointment_date: null, appointment_time: null, appointment: null } : {}),
        bigin_pushed_at: null, last_msg_id: message.id, last_message_at: new Date().toISOString(),
        messages: [...hist, { role: "user", content: messageText }, { role: "assistant", content: reply }].slice(-40),
      } as any).catch(e => console.error("returning customer save error:", e));
      console.log(`[kaya] returning customer ${phone} (step was ${c.step}, ${Math.round(hoursSinceLast)}h ago)`);
      return NextResponse.json({ status: "returning_customer" }, { status: 200 });
    }

    if (isStaleNoHistory) {
      // No history and no car on file → restart the steps, but never delete the record
      console.log(`[kaya] no history for ${phone} at step ${conversation.step} — restarting steps (data kept)`);
      await updateConversation(phone, { step: 0 } as any).catch(() => {});
      conversation.step = 0;
    }

    // Always save the sender's phone number — no need to ask for it
    if (!conversation.phone_number) {
      await updateConversation(phone, { phone_number: phone });
      conversation.phone_number = phone;
    }

    // Insult detection — first insult = obvious frustration → team handoff (below); second → close
    let frustratedByInsult = false;
    if (INSULT_PATTERN.test(messageText)) {
      const insultCount = ((conversation as any).insult_count ?? 0) + 1;
      await updateConversation(phone, { insult_count: insultCount } as any);
      if (insultCount >= 2) {
        // Second insult — close conversation and hand off
        await sendWhatsAppMessage(phone, `I'm going to pass you on to one of our team members — they'll call you ${teamWhen()}. Take care.`);
        await pushLead(phone, "insult close", { salesInquiry: "Other", milestone: "FOLLOW UP" });
        return NextResponse.json({ status: "closed_insult" }, { status: 200 });
      } else {
        frustratedByInsult = true;
      }
    }

    void sendTypingIndicator(message.id); // customer sees "typing…" during the burst wait + reply
    const freshConversation = await getConversation(phone).catch(() => null);
    if (freshConversation) Object.assign(conversation, freshConversation);

    let mediaInBurst = false;
    // ── Burst handling ─────────────────────────────────────────────
    // Customers often send 2–3 quick messages ("fine monday 7pm" / "actually 6"). Record this
    // message, wait a few seconds, and only the LATEST message replies — covering the whole burst.
    {
      const prior = (conversation.messages ?? []) as ConversationMessage[];
      // Incoming history was saved before entering the burst wait.
      const bareMedia = /^\[(photo|file)\]$/.test(messageText);
      // The inbound text and timestamp were already committed before any outbound call.
      await new Promise(r => setTimeout(r, message.id.startsWith("sim_") ? 200 : isMedia ? 8000 : 4000));
      let after = await getConversation(phone).catch(() => null);
      if (after && after.last_msg_id && after.last_msg_id !== message.id) {
        return NextResponse.json({ status: "superseded" }, { status: 200 });
      }
      // Another reply still being written → wait for it, then answer only what's new
      const busyUntil = (after as any)?.processing_until ? Date.parse((after as any).processing_until) : 0;
      if (busyUntil > Date.now()) {
        const deadline = Math.min(busyUntil, Date.now() + 25000);
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 1000));
          const c2 = await getConversation(phone).catch(() => null);
          if (c2?.last_msg_id && c2.last_msg_id !== message.id) return NextResponse.json({ status: "superseded" }, { status: 200 });
          if (!(c2 as any)?.processing_until || Date.parse((c2 as any).processing_until) <= Date.now()) { after = c2; break; }
        }
        after = (await getConversation(phone).catch(() => null)) ?? after;
      }
      await updateConversation(phone, { processing_until: new Date(Date.now() + 30000).toISOString() } as any)
        .then(() => { claimedPhone = phone; }).catch(() => {});
      const ownText = messageText;
      // Combine the trailing customer messages (the burst) into one, history = everything before
      const msgs = ((after?.messages ?? [...prior, { role: "user", content: messageText }]) as ConversationMessage[]);
      let i = msgs.length;
      while (i > 0 && msgs[i - 1].role === "user") i--;
      const burst = msgs.slice(i).map(m => m.content).filter(Boolean);
      if (bareMedia && !burst.includes(messageText)) burst.push(messageText);
      else if (!burst.includes(ownText)) burst.push(ownText); // our message was overwritten by the previous reply's save
      if (after) Object.assign(conversation, after);
      conversation.messages = msgs.slice(0, i) as any;
      if (burst.length > 1) messageText = burst.join("\n");
      // Photos/files in the burst: keep only the text the customer sent with them
      const MEDIA_TAG = /^\[(photo|file)\]\s*/;
      mediaInBurst = burst.some(b => MEDIA_TAG.test(b));
      if (mediaInBurst) messageText = burst.map(b => b.replace(MEDIA_TAG, "").trim()).filter(Boolean).join("\n");
    }

    // Links: Kaya can't open them. Keep the words from the link (ads often contain make/model/year).
    let linkInMsg = false;
    const URL_RE = /https?:\/\/\S+|www\.\S+/gi;
    if (URL_RE.test(messageText)) {
      linkInMsg = true;
      messageText = messageText.replace(URL_RE, u => " " + u.replace(/^https?:\/\/(www\.)?/i, "").split(/[/?#]/).slice(1)
        .join(" ").replace(/[-_+=%]/g, " ").replace(/\b\d{6,}\b/g, "").replace(/\b(used|cars?|motors|listing|ad|ads|en|ar|uae|dubai|for|sale)\b/gi, " ") + " ")
        .replace(/\s+/g, " ").trim();
    }
    // Ask before extraction: never persist an invented expansion of decimal mileage.
    const mileageQuestion=mileageClarification(messageText);
    if(mileageQuestion){
      await sendWhatsAppMessage(phone,mileageQuestion);
      await appendHistory(phone,(conversation.messages??[]) as ConversationMessage[],messageText,mileageQuestion);
      return NextResponse.json({status:"mileage_clarification"},{status:200});
    }
    const LINK_NOTE = "Unfortunately I'm unable to open links, so please share the details with me here.";

    // Only photos/files/links, no text → say we can't see them and ask for the info as text
    if ((mediaInBurst || linkInMsg) && !messageText) {
      const c = conversation as any;
      const missing = ["make", "model", "year"].filter(k => !c[k] || c[k] === "Unknown");
      if (!c.mileage) missing.push("mileage");
      if (!c.specs) missing.push("whether it's GCC or non-GCC");
      const lastQ = [...((conversation.messages ?? []) as ConversationMessage[])].reverse().find(m => m.role === "assistant")?.content ?? "";
      const ask = missing.length && (c.step ?? 0) <= 4
        ? `Could you type the ${missing.length > 1 ? missing.slice(0, -1).join(", ") + " and " + missing[missing.length - 1] : missing[0]}?`
        : /\?\s*$/.test(lastQ) && lastQ.length < 200 ? lastQ : "Could you type the details instead?";
      const reply = mediaInBurst
        ? `Thanks! Unfortunately I'm not able to open photos or files, so I can't see what you sent. ${ask}`
        : `${LINK_NOTE} ${ask}`;
      await sendWhatsAppMessage(phone, reply);
      await appendHistory(phone, (conversation.messages ?? []) as ConversationMessage[], "[sent photos/files]", reply);
      return NextResponse.json({ status: "media_only" }, { status: 200 });
    }

    // The customer wants to call us. Share our number and location, then leave the
    // booking/callback choice open without treating this as consent to a callback.
    const contactHistory = (conversation.messages ?? []) as ConversationMessage[];
    const lastContactReply = [...contactHistory].reverse().find(m => m.role === "assistant")?.content ?? "";
    if (lastContactReply.includes(CUSTOMER_CALL_CHOICE)
        && /^\s*(?:i'?ll|i\s*(?:will|can|am going to)|i'?m|im)\s+(?:call|phone|ring|contact)\s+you(?:\s+(?:later|tomorrow|when ready))?\s*[.!]?\s*$/i.test(messageText)) {
      const reply = "Of course. You can call us on +971 58 582 5543 whenever you're ready. Have a nice day!";
      await sendWhatsAppMessage(phone, reply);
      await updateConversation(phone, { step: CLOSING_STEP, last_msg_id: message.id,
        last_message_at: new Date().toISOString() } as any);
      await appendHistory(phone, contactHistory, messageText, reply);
      return NextResponse.json({ status: "customer_will_call_close" }, { status: 200 });
    }
    if (wantsOurNumber(messageText)) {
      const alreadyBooked = !!(conversation.appointment_date && conversation.appointment_time)
        && contactHistory.some(m => m.role === "assistant" && /you'?re booked for/i.test(m.content));
      const note = "CUSTOMER WILL CALL: Shared customer service number; no callback requested";
      const oldNotes = String((conversation as any).car_conditions ?? "").split(" | ").filter(n => !n.startsWith("CUSTOMER WILL CALL:"));
      const invalidName = /^call$/i.test(String(conversation.name ?? ""));
      await updateConversation(phone, { step: alreadyBooked ? conversation.step : CLOSING_STEP,
        ...(invalidName ? { name: null } : {}), car_conditions: [...oldNotes, note].filter(Boolean).join(" | "),
        last_msg_id: message.id, last_message_at: new Date().toISOString() } as any);
      if (invalidName) conversation.name = null;
      const parts = [LOCATION_TEXT, ...(alreadyBooked ? [] : [CUSTOMER_CALL_CHOICE])];
      for (const part of parts) await sendWhatsAppMessage(phone, part);
      await appendHistory(phone, contactHistory, messageText, parts.join("\n[SPLIT]\n"));
      if (!alreadyBooked) {
        await pushLead(phone, "customer requested our number", { inspectionBooked: false, topNote: "CUSTOMER WILL CALL — no callback requested" });
        await moveLeadToCallBack(phone);
      }
      return NextResponse.json({ status: "customer_will_call" }, { status: 200 });
    }
    if (lastContactReply.includes(CUSTOMER_CALL_CHOICE)) {
      const conditionalPriceVisit = /\b(?:if|only if|provided|assuming|when)\b.{0,80}\b(?:pay|price|amount|offer|match|agree)\b|\b(?:pay|match)\b.{0,40}\b(?:then|if)\b.{0,30}\b(?:come|visit|inspection)\b/i.test(messageText);
      if (conditionalPriceVisit) {
        const reply = "We can't confirm an amount before inspecting the car. The inspection is free, and our purchaser can discuss the options with you afterward.";
        await sendWhatsAppMessage(phone, reply);
        await sendWhatsAppMessage(phone, CUSTOMER_CALL_CHOICE);
        await updateConversation(phone, { last_msg_id: message.id, last_message_at: new Date().toISOString() } as any);
        await appendHistory(phone, contactHistory, messageText, `${reply}\n[SPLIT]\n${CUSTOMER_CALL_CHOICE}`);
        return NextResponse.json({ status: "conditional_price_no_booking" }, { status: 200 });
      }
      const wantsTeamCall = /\b(?:call me|call back|callback|team (?:to )?call|team (?:to )?contact|please call|you (?:can|should) call me|have (?:someone|the team) call)\b/i.test(messageText)
        && !/\b(?:don'?t|do not|no|not)\s+(?:call|contact)\b/i.test(messageText);
      const wantsVisit = /\b(?:continue (?:with )?(?:the )?booking|book (?:an? )?(?:inspection|appointment|slot)|i(?:'ll| will| can) come|i want (?:to )?(?:come|book)|appointment|inspection)\b/i.test(messageText)
        && !/\b(?:don'?t|do not|no|not|can'?t|cannot)\b/i.test(messageText);
      if (wantsTeamCall || wantsVisit || /^\s*(?:no(?:\s+thanks)?|neither|none|i'?ll call (?:you|later)|i will call (?:you|later))\s*[.!]?\s*$/i.test(messageText)) {
        const oldNotes = String((conversation as any).car_conditions ?? "").split(" | ").filter(n => !n.startsWith("CUSTOMER WILL CALL:"));
        const note = wantsTeamCall ? "CUSTOMER WILL CALL: Requested a team callback"
          : wantsVisit ? "CUSTOMER WILL CALL: Continued booking" : "CUSTOMER WILL CALL: No callback requested";
        const reply = wantsTeamCall ? `Thanks. Our team will call you ${teamWhen()}. Have a nice day!`
          : wantsVisit ? "Sure. Which day and time would suit you for the free inspection?"
          : "No problem. You can call us whenever you're ready. Have a nice day!";
        await sendWhatsAppMessage(phone, reply);
        await updateConversation(phone, { step: wantsVisit ? FINAL_STEP : CLOSING_STEP,
          car_conditions: [...oldNotes, note].filter(Boolean).join(" | "),
          last_msg_id: message.id, last_message_at: new Date().toISOString() } as any);
        await appendHistory(phone, contactHistory, messageText, reply);
        if (wantsTeamCall) {
          await pushLead(phone, "customer requested callback", { inspectionBooked: false,
            salesInquiry: contactHistory.some(m => m.role === "user" && PRICE_OFFER_PATTERN.test(m.content)) ? "Price Offer Inquiry" : undefined });
          await moveLeadToCallBack(phone);
        }
        return NextResponse.json({ status: wantsTeamCall ? "requested_callback" : wantsVisit ? "continue_booking" : "customer_will_call_close" }, { status: 200 });
      }
    }

    // A job applicant is not a car seller. Answer once instead of looping on make/model.
    if (/\b(job\s+(vacanc(?:y|ies)|opportunit(?:y|ies))|vacanc(?:y|ies)|looking\s+for\s+(a\s+)?job|career\s+opportunit(?:y|ies)|are\s+you\s+hiring)\b/i.test(messageText)
        && !/\b(sell|selling|my\s+car|book\s+(an?\s+)?inspection)\b/i.test(messageText)) {
      const reply = "Thanks for your interest. I help with car sales enquiries. For job vacancies, please contact our team on 058 582 5543.";
      await sendWhatsAppMessage(phone, reply);
      await updateConversation(phone, { last_msg_id: message.id, last_message_at: new Date().toISOString() } as any).catch(() => {});
      await appendHistory(phone, (conversation.messages ?? []) as ConversationMessage[], messageText, reply);
      return NextResponse.json({ status: "job_inquiry" }, { status: 200 });
    }

    if (isStandaloneOffTopicQuestion(messageText)) {
      const reply = "I help with selling cars, so I can't advise on politics or religion. If you'd like to return to your car, I'm here to help.";
      await sendWhatsAppMessage(phone, reply);
      await updateConversation(phone, { last_msg_id: message.id, last_message_at: new Date().toISOString() } as any).catch(() => {});
      await appendHistory(phone, (conversation.messages ?? []) as ConversationMessage[], messageText, reply);
      return NextResponse.json({ status: "off_topic" }, { status: 200 });
    }

    // ── Trade-in: customer sells AND buys → normal selling flow, flagged for the team ──
    if (TRADE_IN_PATTERN.test(messageText) && !String((conversation as any).car_conditions ?? "").includes("Trade-in:")) {
      const note = "Trade-in: customer also wants to buy a car";
      const ex = (conversation as any).car_conditions ?? "";
      (conversation as any).car_conditions = ex ? `${ex} | ${note}` : note;
      await updateConversation(phone, { car_conditions: (conversation as any).car_conditions } as any).catch(() => {});
    }
    // ─────────────────────────────────────────────────────────────────────

    // ── Opt-out ("stop messaging me") ───────────────────────────────────────
    // "Don't call me (just WhatsApp)" is a contact preference, not an opt-out
    if (/\b(don'?t|do not|no)\s+(call|calls|phone)\b|\b(whatsapp|text|message)\s+only\b|\bonly\s+(whatsapp|text|message)/i.test(messageText)
        && !String((conversation as any).car_conditions ?? "").includes("Prefers WhatsApp")) {
      const ex = String((conversation as any).car_conditions ?? "");
      const note = "Prefers WhatsApp, no calls";
      (conversation as any).car_conditions = ex ? `${ex} | ${note}` : note;
      await updateConversation(phone, { car_conditions: (conversation as any).car_conditions } as any).catch(() => {});
    }
    // 2. An opted-out customer who writes again has re-engaged → remove the opt-out note
    if (String((conversation as any).car_conditions ?? "").includes("OPTED OUT:")) {
      const cleaned = String((conversation as any).car_conditions).split(" | ").filter(n => !n.startsWith("OPTED OUT:")).join(" | ") || null;
      (conversation as any).car_conditions = cleaned;
      await updateConversation(phone, { car_conditions: cleaned } as any).catch(() => {});
    }
    if (/\b(stop (messaging|texting|contacting|sending|writing)( me)?|unsubscribe|don'?t (message|text|contact) me|do not (message|text|contact) me|leave me alone|remove my (number|details)|opt[\s-]?out)\b|^\s*stop\s*[.!]*\s*$/i.test(messageText)) {
      const reply = `Understood. We won't contact you again. You're always welcome whenever you're ready.\n\n${LOCATION_TEXT}`;
      await sendWhatsAppMessage(phone, reply);
      const ex = String((conversation as any).car_conditions ?? "");
      const note = "OPTED OUT: asked not to be messaged — do not contact";
      await updateConversation(phone, {
        step: CLOSING_STEP, last_message_at: new Date().toISOString(),
        ...(ex.includes("OPTED OUT:") ? {} : { car_conditions: ex ? `${ex} | ${note}` : note }),
      } as any).catch(() => {});
      await appendHistory(phone, (conversation.messages ?? []) as ConversationMessage[], messageText, reply);
      await pushLead(phone, "opted out", { inspectionBooked: false });
      await moveLeadToCallBack(phone);
      return NextResponse.json({ status: "opted_out" }, { status: 200 });
    }

    // ── Buyers ───────────────────────────────────────────────────────────────
    {
      const BUY_INTENT = /\b(i\s*(want|need|would like|wanna|am looking|'?m looking|plan)\s+(to\s+)?(buy|purchase)\b|i\s*(want|need|would like|wanna)\s+(to\s+)?get\s+(a|an)\s+(new\s+|used\s+)?(car|vehicle|suv)\b|looking\s+to\s+buy|looking\s+for\s+a\s+(car|vehicle)\s+to\s+buy|do\s+you\s+(sell|have)\s+(any\s+)?cars|what\s+cars\s+do\s+you\s+have|your\s+(stock|inventory))/i;
      const BUY_Q = "Are you also looking to sell a car (as a trade-in), or only looking to buy?";
      const BUYER_LINE    = "Our sales team will contact you.";
      const BUYER_NAME_Q  = "May I have your name?";
      const BUYER_PHONE_Q = "Which UAE number is best to reach you on?";
      const BUYER_AVAIL_Q = "When is a good time for our sales team to call you?";
      const histB = (conversation.messages ?? []) as ConversationMessage[];
      const lastAB = [...histB].reverse().find(m => m.role === "assistant")?.content ?? "";
      const notesB: string = (conversation as any).car_conditions ?? "";
      const addNoteB = async (n: string) => {
        const upd = notesB.includes(n) ? notesB : (notesB ? `${notesB} | ${n}` : n);
        (conversation as any).car_conditions = upd;
        await updateConversation(phone, { car_conditions: upd } as any).catch(() => {});
      };
      // Buyer-only details: name → UAE number → availability → close
      const inBuyerMode = (histB.some(m => m.role === "assistant" && m.content.includes(BUYER_LINE)) || notesB.includes("BUYER:"))
        && (conversation.step ?? 0) < CLOSING_STEP;
      if (inBuyerMode) {
        const upd: Record<string, unknown> = { last_message_at: new Date().toISOString() };
        if (lastAB.includes(BUYER_NAME_Q) && !conversation.name) {
          const n = extractNameFromMessage(messageText);
          if (n) { upd.name = n; conversation.name = n; }
        } else if (lastAB.includes(BUYER_PHONE_Q)) {
          const pm = messageText.match(/(?:\+?971|00971|0)?\s*5\d[\s-]?\d{3}[\s-]?\d{4}/);
          if (pm) {
            const raw = pm[0].replace(/\D/g, "");
            const alt = raw.startsWith("971") ? raw : `971${raw.replace(/^0/, "")}`;
            if (alt !== phone) upd.alternative_phone = alt;
          }
        } else if (lastAB.includes(BUYER_AVAIL_Q)) {
          await addNoteB(`Best time to call: ${messageText.trim()}`);
        }
        const asked = (q: string) => histB.some(m => m.role === "assistant" && m.content.includes(q));
        const nextQ = !conversation.name && !asked(BUYER_NAME_Q) ? BUYER_NAME_Q
          : !isUAE && !asked(BUYER_PHONE_Q) ? BUYER_PHONE_Q
          : !asked(BUYER_AVAIL_Q) ? BUYER_AVAIL_Q
          : null;
        const reply = nextQ ?? `Thanks! Our sales team will contact you ${teamWhen()}. Have a nice day!`;
        if (!nextQ) upd.step = CLOSING_STEP;
        await sendWhatsAppMessage(phone, reply);
        await updateConversation(phone, upd as any).catch(() => {});
        await appendHistory(phone, histB, messageText, reply);
        if (!nextQ) await pushLead(phone, "buyer — details complete", { salesInquiry: "Other", inspectionBooked: false });
        return NextResponse.json({ status: "buyer_details" }, { status: 200 });
      }

      if (lastAB.includes(BUY_Q)) {
        const words = messageText.toLowerCase().split(/[^a-z0-9-]+/);
        const selling = /\b(sell|selling|trade|exchange|swap|both|yes|also|part)\b/i.test(messageText) && !/\b(only|just)\s+(buy|buying|looking)/i.test(messageText)
          || words.some(w => CAR_WORDS.has(w));
        if (selling) {
          await addNoteB("Trade-in: customer also wants to buy a car");
          if ((conversation.step ?? 0) < 2) {
            conversation.step = 2;
            await updateConversation(phone, { step: 2 } as any).catch(() => {});
          }
          // fall through → normal selling flow (asks the car if it's not in this message)
        } else {
          await addNoteB(`BUYER: wants to buy a car, not selling`);
          const nextQ = !conversation.name ? BUYER_NAME_Q : !isUAE ? BUYER_PHONE_Q : null;
          const reply = `No problem! ${BUYER_LINE} ${nextQ}`;
          await sendWhatsAppMessage(phone, reply);
          await updateConversation(phone, { last_message_at: new Date().toISOString() } as any).catch(() => {});
          await appendHistory(phone, histB, messageText, reply);
          await pushLead(phone, "buyer", { salesInquiry: "Other", inspectionBooked: false, milestone: "FOLLOW UP" });
          return NextResponse.json({ status: "buyer" }, { status: 200 });
        }
      } else if (BUY_INTENT.test(messageText) && (conversation.step ?? 0) < CLOSING_STEP && !notesB.includes("Trade-in:")) {
        await addNoteB(`Wants to buy: ${messageText.trim()}`);
        const reply = `Happy to help! ${BUY_Q}`;
        await sendWhatsAppMessage(phone, reply);
        await updateConversation(phone, { last_message_at: new Date().toISOString() } as any).catch(() => {});
        await appendHistory(phone, histB, messageText, reply);
        return NextResponse.json({ status: "buyer_question" }, { status: 200 });
      }
    }

    // ── Returning customer answered "same car, or a different one?" ─────────
    {
      const lastA = [...((conversation.messages ?? []) as ConversationMessage[])].reverse().find(m => m.role === "assistant")?.content ?? "";
      if (/same car, or a different one\?/i.test(lastA)) {
        const oldWords = [conversation.make, conversation.model].filter(Boolean).map(w => String(w).toLowerCase());
        const mentionedOtherCar = messageText.toLowerCase().split(/[^a-z0-9-]+/).some(w => CAR_WORDS.has(w) && !oldWords.some(o => o.includes(w)));
        const different = /\b(different|another|new|other|second|no\b|not the same|sold)/i.test(messageText) || mentionedOtherCar;
        if (!different) {
          // Same car → details already known, go straight to booking
          const q = getBookingSlot().match(/Ask exactly: "([^"]+)"/)?.[1] ?? "What time can you come in tomorrow?";
          const reply = `Great. The next step is a free 10–15 minute inspection at our Umm Suqeim Branch in Al Quoz 4. ${q}`;
          await sendWhatsAppMessage(phone, reply);
          await updateConversation(phone, { step: FINAL_STEP, last_message_at: new Date().toISOString() } as any).catch(() => {});
          await appendHistory(phone, (conversation.messages ?? []) as ConversationMessage[], messageText, reply);
          return NextResponse.json({ status: "returning_same_car" }, { status: 200 });
        }
        // Different car → old car moves into the notes, name kept, car questions start
        const oc = conversation as any;
        const oldCar = [oc.year, oc.make, oc.model].filter((v: any) => v && v !== "Unknown").join(" ")
          + (oc.mileage && oc.mileage !== "Unknown" ? `, ${oc.mileage} km` : "") + (oc.specs ? `, ${oc.specs}` : "")
          + (oc.appointment_date ? `, inspection was booked ${oc.appointment_date} ${oc.appointment_time ?? ""}`.trimEnd() : "");
        const keptNotes = String(oc.car_conditions ?? "").split(" | ").filter(n => /^(Other car|Also selling|Cars):/.test(n));
        const notes = [...keptNotes, oldCar ? `Other car: ${oldCar} (earlier inquiry)` : ""].filter(Boolean).join(" | ") || null;
        const cleared: Record<string, null> = {
          car: null, make: null, model: null, year: null, mileage: null, specs: null, loan: null,
          mortgage_amount: null, sell_timeline: null, estimated_price: null, car_conditions: null,
          non_gcc_handoff: null, owner_status: null,
        };
        await updateConversation(phone, { ...cleared, car_conditions: notes, step: 2 } as any).catch(async () => {
          // some columns may not exist — retry with the core ones
          await updateConversation(phone, { car: null, make: null, model: null, year: null, mileage: null, specs: null, loan: null, mortgage_amount: null, sell_timeline: null, step: 2 } as any).catch(() => {});
        });
        Object.assign(conversation, cleared, { car_conditions: notes, step: 2 });
      }
    }

    const currentStep = conversation.step ?? 0;
    // Advice is a question, not a choice of consignment or consent to book.
    if ((currentStep === 6 || currentStep === FINAL_STEP) && asksBestWayToSell(messageText)
        && !/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday)\b.*\b(\d{1,2}\s*(am|pm)|noon)\b/i.test(messageText)) {
      const reply = "We can help you sell quickly with cash payment on the spot after we inspect the car and agree on a price. Or, with consignment, we put the car for sale in our showroom and sell it directly to an end user. That usually puts more money in your pocket; allow at least 3–4 weeks. Is a quick transfer with cash payment more important, or do you have 3–4 weeks to sell?";
      await sendWhatsAppMessage(phone, reply);
      await updateConversation(phone, { last_msg_id: message.id, last_message_at: new Date().toISOString() } as any).catch(() => {});
      await appendHistory(phone, (conversation.messages ?? []) as ConversationMessage[], messageText, reply);
      return NextResponse.json({ status: "selling_advice" }, { status: 200 });
    }
    const fieldToSave = FIELD_BY_STEP[currentStep];
    {
      const lastA = [...((conversation.messages ?? []) as ConversationMessage[])].reverse().find(m => m.role === "assistant")?.content ?? "";
      const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (lastA && norm(messageText).length > 15 && norm(lastA).includes(norm(messageText))) {
        // Customer copied Kaya's question back (e.g. "Is it GCC or non-GCC specs?") — not an answer
        const ask = /gcc/i.test(messageText) ? "Is the car GCC specs (made for the Gulf), or imported from another country?" : lastA.split(/\n\n/).pop()!;
        await sendWhatsAppMessage(phone, ask);
        await updateConversation(phone, { last_msg_id: message.id } as any).catch(() => {});
        await appendHistory(phone, (conversation.messages ?? []) as ConversationMessage[], messageText, ask);
        return NextResponse.json({ status: "echo" }, { status: 200 });
      }
    }

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
    if (conversation.name && /\b(actually|sorry|correction|not)\b/i.test(messageText) && /\b(my\s+name|name\s+is|name'?s|call\s+me)\b/i.test(messageText)) {
      const n = extractNameFromMessage(messageText.replace(/\b(actually|sorry|correction)\b,?\s*/gi, ""));
      if (n && n.toLowerCase() !== String(conversation.name).toLowerCase()) (coreUpdates as any).name = n;
    }
    if (!conversation.name && currentStep >= 2 && !(coreUpdates as any).name) {
      const lastAskedName = [...((conversation.messages ?? []) as ConversationMessage[])].reverse()
        .find(m => m.role === "assistant")?.content ?? "";
      if (/may i (have|know) your name|what'?s your name|your name( please)?\?/i.test(lastAskedName)) {
        const n = extractNameFromMessage(messageText);
        if (n) (coreUpdates as any).name = n;
      }
    }
    // Name sent later as its own line in a burst ("Abdul\n90000 km\nGCC") after we asked for it earlier
    if (!conversation.name && !(coreUpdates as any).name
        && ((conversation.messages ?? []) as ConversationMessage[]).some(m => m.role === "assistant" && /may i (have|know) your name/i.test(m.content))) {
      const line = messageText.split(/\n+/).map(l => l.trim()).find(l => /^[A-Za-z]{2,15}( [A-Za-z]{2,15})?$/.test(l) && looksLikeName(l) && !CAR_WORDS.has(l.toLowerCase()));
      if (line && messageText.includes("\n")) (coreUpdates as any).name = nameCase(line);
    }
    if (!conversation.name && !(coreUpdates as any).name && currentStep < 2) {
      // Early in the chat only a clear "I'm Marc." / "my name is Marc," — never "I'm tied up most of the week"
      const em = messageText.match(/\b(?:my\s+name\s+is|my\s+name'?s|i'?m|i\s+am|this\s+is)\s+([A-Za-z]{2,15})(?=\s*(?:[.,!]|$|\band\b|\bhere\b))/i);
      if (em && looksLikeName(em[1]) && !/^(sorry|busy|fine|good|ok|okay|here|interested|selling|looking|ready|tied|new|back|done|happy|available|free|not)$/i.test(em[1])) (coreUpdates as any).name = nameCase(em[1]);
    }
    if (!conversation.name && !(coreUpdates as any).name && currentStep >= 2) {
      const nm = messageText.match(/\b(?:my\s+name\s+is|my\s+name'?s|i'?m|i\s+am|this\s+is|call\s+me|name\s*:)\s+([A-Za-z]{2,}(?:\s+[A-Za-z]{2,}){0,3})\b/i);
      const NOT_NAMES = /^(selling|looking|interested|not|ok|okay|fine|good|here|coming|ready|sure|busy|planning|going|thinking|in|at|from|the|a|an|out|done|happy|available|free|asking|trying)\b/i;
      if (nm && !NOT_NAMES.test(nm[1])) {
        const words = nm[1].trim().split(/\s+/);
        let k = 0; while (k < words.length && looksLikeName(words.slice(0, k + 1).join(" "))) k++;
        if (k > 0) (coreUpdates as any).name = nameCase(words.slice(0, k).join(" "));
      }
    }

    // A name found in this message is saved right away, so the special flows (Hiyaza, truck, buyer…) don't ask again
    if ((coreUpdates as any).name && !conversation.name) {
      conversation.name = (coreUpdates as any).name;
      await updateConversation(phone, { name: conversation.name } as any).catch(() => {});
    }

    let askOrigin = false;
    const alreadyKnown: VehicleFields = {
      make:    (conversation.make    && conversation.make    !== "Unknown") ? conversation.make    : undefined,
      model:   (conversation.model   && conversation.model   !== "Unknown") ? conversation.model   : undefined,
      year:    conversation.year    ?? undefined,
      mileage: conversation.mileage ?? undefined,
      specs:   conversation.specs   ?? undefined,
    };
    // Also at step 0: "Hi, I have a Nissan Patrol 2020" must be saved, not asked again later
    const vehicleUpdates = await extractVehicleInfo(messageText, currentStep === 0 ? {} : alreadyKnown);

    if (!vehicleUpdates.model || vehicleUpdates.model === "Unknown") {
      const effectiveMake = vehicleUpdates.make ?? conversation.make;
      if (effectiveMake && effectiveMake !== "Unknown") {
        // Fallback for models not in the reference: take the word right after the make
        // ("2023 JAC JS4 FULL OPTION" → "JS4")
        const makeRe = new RegExp(`\\b${effectiveMake.replace(/[-\s&]/g, "[-\\s&]?")}\\s+([A-Za-z0-9][A-Za-z0-9-]{0,11}(?:\\s+(?:Pro|Plus|Max|Sport|Hybrid))?)`, "i");
        const after = messageText.match(makeRe)?.[1];
        const STOP = /^(car|model|full|option|options|fully|loaded|for|in|is|the|my|with|and|gcc|non|spec|specs|km|kms|white|black|red|blue|grey|gray|silver|\d{4})$/i;
        const found = quickModelMatch(messageText, effectiveMake)
          ?? (after && !STOP.test(after.split(/\s+/)[0]) ? after.toUpperCase() === after || /\d/.test(after) ? after.toUpperCase() : after.charAt(0).toUpperCase() + after.slice(1).toLowerCase() : undefined);
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

    // Implausible mileage ("8.6 km" on a 2016 car) → don't store it as mileage
    {
      const yr = parseInt(String(vehicleUpdates.year ?? conversation.year ?? ""), 10);
      const km = vehicleUpdates.mileage ? parseInt(String(vehicleUpdates.mileage), 10) : NaN;
      if (!isNaN(km) && km < 1000 && yr && yr < new Date().getFullYear()) {
        if (km >= 10) vehicleUpdates.mileage = String(km * 1000); // "180" → 180,000 km
        else { console.warn(`[kaya] implausible mileage "${vehicleUpdates.mileage}" for ${yr} car — not saved`); delete vehicleUpdates.mileage; }
      }
    }

    // Saved mileage/specs are only overwritten when the customer is correcting them
    const CORRECTION = /\b(sorry|actually|correction|correct (one|is)|i mean|i meant|my mistake|mistake|wrong|typo|instead|not\s+\d|not\s+(?:in\s+)?(?:km|kms|kilometers?|kilometres?))\b/i;
    const isCorrection = CORRECTION.test(messageText);
    if (alreadyKnown.mileage && vehicleUpdates.mileage && !isCorrection) delete vehicleUpdates.mileage;
    // Make / model / year are never overwritten by later messages ("Still under service contract" became
    // model "Still") — only when the customer corrects them
    if (alreadyKnown.make  && vehicleUpdates.make  && !isCorrection) delete vehicleUpdates.make;
    if (alreadyKnown.model && vehicleUpdates.model && !isCorrection) delete vehicleUpdates.model;
    if (alreadyKnown.year  && vehicleUpdates.year  && !isCorrection) delete vehicleUpdates.year;
    if (vehicleUpdates.model && /^(still|under|new|brand|first|owner|service|contract|warranty|car|full|option|scratch\w*|scract\w*|clean|recently|only|complete|ppf|the|my|it|is|no|yes|ok|okay)$/i.test(String(vehicleUpdates.model).trim())) delete vehicleUpdates.model;
    if (alreadyKnown.specs   && vehicleUpdates.specs   && !isCorrection) delete vehicleUpdates.specs;
    if (isCorrection) {
      // "the mileage is 45k not 25k" → the first figure is the new one
      const mc = messageText.match(/\b(\d+(?:\.\d+)?)\s*k\b|\b(\d{1,3}(?:[,.]\d{3})+|\d{4,7})\s*(?:km|kms|kilomet\w*)\b/i);
      if (mc && /\b(mileage|km|kms|kilomet|driven|odometer|k)\b/i.test(messageText) && !/\b(loan|bank|mortgage|price|aed|dhs)\b/i.test(messageText)) {
        vehicleUpdates.mileage = mc[1] ? String(Math.round(parseFloat(mc[1]) * 1000)) : mc[2].replace(/[,.]/g, "");
      }
      const correctedSpecs = specsStatement(messageText);
      if (correctedSpecs === "GCC" || correctedSpecs === "Unknown") vehicleUpdates.specs = correctedSpecs;
    }

    // An unclear spec is Unknown; purchase location and country of origin never decide specs.
    if (currentStep < 8 && /\bgcc\b/i.test(messageText)
        && /\b(don'?t|do not|didn'?t|dont)\s+(understand|know what|get)|\bwhat (is|does|are|means?)\b.{0,20}\bgcc\b|\bgcc\b.{0,15}\bmean|\bmeaning\b/i.test(messageText)) {
      vehicleUpdates.specs = "Unknown";
    }
    // Deterministic backup for specs + mileage — never re-ask something the customer already said
    if (currentStep >= 1 && currentStep <= 4) {
      const IN_MILES = /\d\s*k?\s*(?:miles?|mills?)\b/i.test(messageText);
      // "I don't understand what GCC specs" mentions GCC but is not an answer
      const GCC_CONFUSED = /\b(don'?t|do not|didn'?t|dont)\s+(understand|know what|get)|\bwhat (is|does|are|means?)\b.{0,20}\bgcc\b|\bgcc\b.{0,15}\bmean|\bmeaning\b|^\s*\?+\s*$|\bwhat\?\s*$/i.test(messageText);
      if (GCC_CONFUSED && !alreadyKnown.specs) vehicleUpdates.specs = "Unknown";
      // Answer to "GCC specs, right?" → yes = GCC, no = non-GCC
      {
        const lastQ = [...((conversation.messages ?? []) as ConversationMessage[])].reverse().find(m => m.role === "assistant")?.content ?? "";
        const askedGcc = /\bGCC\b[^?]{0,40}\?/i.test(lastQ);
        if (askedGcc && !alreadyKnown.specs && !vehicleUpdates.specs) {
          if (/^\s*(yes|yeah|yep|ya|👍)\s*[.!]?\s*$/i.test(messageText)) vehicleUpdates.specs = "GCC";
          else if (/^\s*(no|nope|nah)\s*[.!]?\s*$/i.test(messageText)) vehicleUpdates.specs = "Unknown";
        }
      }
      // Typo in the year ("20002", "20188", "2o18") right after we asked for it → take the real year, never ask again
      {
        const lastQy = [...((conversation.messages ?? []) as ConversationMessage[])].reverse().find(m => m.role === "assistant")?.content ?? "";
        const maxY = new Date().getFullYear() + 1;
        const okY = (y: number) => y >= 1975 && y <= maxY;
        if ((!alreadyKnown.year || !okY(+alreadyKnown.year)) && (!vehicleUpdates.year || !okY(+vehicleUpdates.year)) && /\byear\b/i.test(lastQy)) {
          const raw = messageText.trim().replace(/[oO]/g, "0");
          const m = raw.match(/^\D{0,12}(\d{3,6})\D{0,12}$/);
          if (m && !/\b(km|kms|miles?|k)\b/i.test(messageText)) {
            const d = m[1];
            let year: number | null = null;
            if (d.length === 4 && okY(+d)) year = +d;
            else if (d.length === 5 || d.length === 6) {
              // drop one (or two) extra digits — prefer removing a doubled digit: 20002 → 2002, 20188 → 2018
              const cands: number[] = [];
              for (let i = 0; i < d.length; i++) { const c = d.slice(0, i) + d.slice(i + 1); if (c.length === 4 && okY(+c)) cands.push(+c); if (c.length === 5) for (let j = 0; j < c.length; j++) { const c2 = c.slice(0, j) + c.slice(j + 1); if (okY(+c2)) cands.push(+c2); } }
              const doubled = [...d].findIndex((ch, i) => i > 0 && ch === d[i - 1]);
              const pref = doubled > 0 ? +(d.slice(0, doubled) + d.slice(doubled + 1)) : NaN;
              year = okY(pref) && d.length === 5 ? pref : (cands[0] ?? null);
            } else if (d.length === 3 && /^0\d\d$|^[12]\d\d$/.test(d)) {
              // "018" → 2018, "219" → 2019 is too unsure — only the leading-zero form
              if (/^0\d\d$/.test(d) && okY(2000 + +d.slice(1))) year = 2000 + +d.slice(1);
            }
            if (year) { vehicleUpdates.year = String(year); console.log(`[kaya] year typo "${d}" → ${year} for ${phone}`); }
          }
        }
      }
      // Indian/Pakistani counting: "3 lakh" = 300,000 km (the extractor misreads it)
      {
        const ml = messageText.match(/\b(\d+(?:\.\d+)?)\s*(?:lakhs?|lacs?|lakh?s?)\b/i);
        if (ml && !alreadyKnown.mileage && !/\b(loan|bank|mortgage|price|aed|dhs|dirham|offer)\b/i.test(messageText)) {
          vehicleUpdates.mileage = String(Math.round(parseFloat(ml[1]) * 100000));
        }
      }
      if (!alreadyKnown.mileage && !vehicleUpdates.mileage) {
        const mk = messageText.match(/\b(\d+(?:\.\d+)?)\s*k\s*(?:km|kms|kilomet\w*)?\b/i);
        const mf = messageText.match(/\b(\d{1,3}(?:[,.]\d{3})+|\d{3,7})\s*(?:km|kms|kilomet\w*)\b/i);
        const mm = messageText.match(/\b(\d{1,3}(?:[,.]\d{3})+|\d+(?:\.\d+)?\s*k?)\s*(?:miles?|mills?)\b/i);
        if (mk) vehicleUpdates.mileage = String(Math.round(parseFloat(mk[1]) * 1000));
        else if (mf) vehicleUpdates.mileage = mf[1].replace(/[,.]/g, "");
        else if (mm) {
          const raw = mm[1].replace(/[,.](?=\d{3})/g, "").trim();
          vehicleUpdates.mileage = String(/k$/i.test(raw) ? parseFloat(raw) * 1000 : parseFloat(raw));
        }
      }
      // Miles → km (US imports): the extractor stores the number as-is
      if (IN_MILES && (!alreadyKnown.mileage || isCorrection)) {
        const rawMiles = messageText.match(/\b(\d{1,3}(?:[,.]\d{3})+|\d+(?:\.\d+)?\s*k?)\s*(?:miles?|mills?)\b/i)?.[1];
        if (rawMiles) {
          const raw = rawMiles.replace(/[,.](?=\d{3}\b)/g, "").trim();
          const miles = parseFloat(raw) * (/k$/i.test(raw) ? 1000 : 1);
          vehicleUpdates.mileage = String(Math.round(miles * 1.609344));
          const note = `Mileage reported: ${Math.round(miles)} miles (converted to ${vehicleUpdates.mileage} km)`;
          const ex = String((conversation as any).car_conditions ?? "").split(" | ").filter(x => !x.startsWith("Mileage reported:"));
          (conversation as any).car_conditions = [...ex, note].join(" | ");
          await updateConversation(phone, { car_conditions: (conversation as any).car_conditions } as any).catch(() => {});
        }
      }
    }
    if (currentStep > 4 && isCorrection && /\b(?:miles?|mills?)\b/i.test(messageText)) {
      const rawMiles = messageText.match(/\b(\d{1,3}(?:[,.]\d{3})+|\d+(?:\.\d+)?\s*k?)\s*(?:miles?|mills?)\b/i)?.[1];
      if (rawMiles) {
        const raw = rawMiles.replace(/[,.](?=\d{3}\b)/g, "").trim();
        const miles = parseFloat(raw) * (/k$/i.test(raw) ? 1000 : 1);
        vehicleUpdates.mileage = String(Math.round(miles * 1.609344));
        const old = String((conversation as any).car_conditions ?? "").split(" | ").filter(x => !x.startsWith("Mileage reported:"));
        (conversation as any).car_conditions = [...old, `Mileage reported: ${Math.round(miles)} miles (converted to ${vehicleUpdates.mileage} km)`].join(" | ");
        await updateConversation(phone, { car_conditions: (conversation as any).car_conditions } as any).catch(() => {});
      }
    }

    // Ownership detection — save once, don't overwrite
    if (!conversation.owner_status) {
      if (POA_PATTERN.test(messageText))   await updateConversation(phone, { owner_status: "POA" } as any).catch(() => {});
      else if (OWNER_PATTERN.test(messageText)) await updateConversation(phone, { owner_status: "Owner" } as any).catch(() => {});
    }

    // ── Several cars ──────────────────────────────────────────────────
    // First car → regular DB fields (normal flow). Everything the customer says about the
    // cars is also kept in the notes, so all other cars end up in the summary / Bigin.
    // Only clear multi-car signals. "I also have the service history", "I also have a loan",
    // "bought another car so selling this one" are NOT multiple cars.
    const MULTI_CARS = /\b(two|2|three|3|four|4|five|5|few|several|multiple|both)\s+(of\s+(my|our|the)\s+)?(cars|vehicles)\b|\b(sell|selling|sale)\b.{0,40}\b(another|second|2nd|one more|other)\s+(car|vehicle)\b.{0,15}\b(too|as well|also)\b|\b(another|second|2nd|one more)\s+(car|vehicle)\s+(to sell|for sale|i want to sell|i'?m selling)\b|\balso\s+(selling|want to sell|wanna sell)\s+(a|an|my|another|the)\b|\bcars\s+(for sale|to sell)\b/i;
    const MULTI_ASK = "of each car";
    const multiMode = ((conversation.messages ?? []) as ConversationMessage[]).some(m => m.role === "assistant" && m.content.includes(MULTI_ASK))
      || String((conversation as any).car_conditions ?? "").includes("Multiple cars:");
    const mentionsMulti = MULTI_CARS.test(messageText);
    const looksLikeCarDetails = !!(vehicleUpdates.make || vehicleUpdates.model || vehicleUpdates.year || vehicleUpdates.mileage);
    // Several cars = team handoff: details of each car → owner? → personal/company? → number → close.
    // No booking. Other questions (home visit etc.) → "discuss with the team", then repeat the open question.
    if ((mentionsMulti || multiMode) && currentStep < CLOSING_STEP) {
      const hist = (conversation.messages ?? []) as ConversationMessage[];
      const asked = (q: string) => hist.some(m => m.role === "assistant" && m.content.includes(q));
      const lastA = [...hist].reverse().find(m => m.role === "assistant")?.content ?? "";
      const OWNER_Q = "Are you the registered owner of the cars?";
      const REG_Q   = "Are they registered under your personal name or a company name?";
      const PHONE_Q = "Which UAE number is best to reach you on?";
      const DETAILS_Q = `Could you share the make, model, year, mileage and specs (GCC or non-GCC) ${MULTI_ASK}? One message is fine.`;
      const firstTime = !multiMode;
      const updates: Record<string, unknown> = { ...vehicleDbFields(vehicleUpdates), last_msg_id: message.id };
      let notes: string = (conversation as any).car_conditions ?? "";
      const addNote = (n: string) => { if (!notes.includes(n)) notes = notes ? `${notes} | ${n}` : n; };

      // A question instead of an answer → team will discuss it; repeat the open question
      const isOtherQuestion = !firstTime && /\?|\b(do|does|can|could|will|would)\s+(you|u)\b|\bhome\s*(visit|service|pick\s*up)|\bhow much\b|\bprice\b/i.test(messageText)
        && !looksLikeCarDetails && !/^(yes|no|yeah|yep|nope|personal|company|private)\b/i.test(messageText.trim());

      if (!isOtherQuestion && !firstTime) {
        if (lastA.includes(MULTI_ASK)) addNote(`Cars: ${messageText.trim()}`);
        else if (lastA.includes(OWNER_Q)) {
          updates.owner_status = /\b(no|not|brother|sister|father|mother|wife|husband|friend|family|poa|attorney|company)\b/i.test(messageText) ? `Not owner: ${messageText.trim()}` : "Owner";
          addNote(`Owner: ${messageText.trim()}`);
        } else if (lastA.includes(REG_Q)) {
          addNote(`Registered under: ${/company|business|corporate|llc|fze|establishment/i.test(messageText) ? "company" : /personal|my name|private|own name|individual/i.test(messageText) ? "personal name" : messageText.trim()}`);
        } else if (lastA.includes(PHONE_Q)) {
          const pm = messageText.match(/(?:\+?971|00971|0)?\s*5\d[\s-]?\d{3}[\s-]?\d{4}/);
          if (pm) {
            const raw = pm[0].replace(/\D/g, "");
            const alt = raw.startsWith("971") ? raw : `971${raw.replace(/^0/, "")}`;
            if (alt !== phone) updates.alternative_phone = alt;
          }
        }
      }
      if (firstTime) { addNote("Multiple cars: team handoff"); addNote(`Cars: ${messageText.trim()}`); }
      if (notes) updates.car_conditions = notes;

      let nextQ: string | null;
      if (isOtherQuestion) nextQ = [DETAILS_Q, OWNER_Q, REG_Q, PHONE_Q].find(q => lastA.includes(q) || (q === DETAILS_Q && lastA.includes(MULTI_ASK))) ?? (isUAE ? null : PHONE_Q);
      else if (firstTime || !asked(MULTI_ASK)) nextQ = DETAILS_Q;
      else if (!asked(OWNER_Q)) nextQ = OWNER_Q;
      else if (!asked(REG_Q)) nextQ = REG_Q;
      else if (!isUAE && !asked(PHONE_Q)) nextQ = PHONE_Q;
      else nextQ = null;

      const reply = isOtherQuestion
        ? `That's something our team can discuss with you directly. ${nextQ}`
        : firstTime
          ? `Happy to look at all of them! ${DETAILS_Q}`
          : nextQ ?? `Thanks, I've got everything I need. Our team will get back to you ${teamWhen()}. Have a nice day!`;

      await sendWhatsAppMessage(phone, reply);
      updates.step = nextQ ? Math.max(currentStep, 2) : CLOSING_STEP;
      updates.last_message_at = new Date().toISOString();
      await updateConversation(phone, updates as any).catch(async (e) => {
        console.error("multi-car save error:", e);
        await updateConversation(phone, { step: updates.step, car_conditions: notes || null } as any).catch(() => {});
      });
      await appendHistory(phone, hist, messageText, reply);
      if (firstTime || !nextQ) await pushLead(phone, firstTime ? "multiple cars" : "multiple cars — details complete", { salesInquiry: "Other", inspectionBooked: false, milestone: firstTime ? "FOLLOW UP" : undefined });
      return NextResponse.json({ status: "multi_cars" }, { status: 200 });
    }

    // Car conditions — append any new condition signals mentioned
    if (CONDITION_PATTERN.test(messageText)) {
      const existing = (conversation as any).car_conditions ?? "";
      const newCondition = messageText.trim();
      const updated = existing ? `${existing} | ${newCondition}` : newCondition;
      await updateConversation(phone, { car_conditions: updated } as any).catch(() => {});
    }

    // The extractor may infer market specs from a country or import history. Override it
    // with the customer's explicit spec label and the Mulkiya engine-number check.
    const specQuestion = [...((conversation.messages ?? []) as ConversationMessage[])].reverse()
      .find(m => m.role === "assistant")?.content ?? "";
    const specClaim = specsStatement(messageText, /\b(specs?|gcc)\b/i.test(specQuestion) && /\?/.test(specQuestion));
    const notesForSpecs = String((conversation as any).car_conditions ?? "");
    const pendingMulkiya = notesForSpecs.includes("Mulkiya specs check pending");
    if (pendingMulkiya) {
      const answer = mulkiyaAnswer(messageText);
      vehicleUpdates.specs = answer === "NON_GCC" ? "Non-GCC" : "Unknown";
      const note = answer === "NON_GCC" ? "Non-GCC: Mulkiya engine number NONE/NIL/blank"
        : answer === "ENGINE_PRESENT" ? "Specs conflict: claimed non-GCC, engine number present; team to verify"
        : "Specs unknown: unable to check Mulkiya";
      (conversation as any).car_conditions = notesForSpecs.replace(/(?:^| \| )Mulkiya specs check pending(?: \| )?/, " | ").replace(/^ \| | \| $/g, "").trim();
      (conversation as any).car_conditions = [(conversation as any).car_conditions, note].filter(Boolean).join(" | ");
      if (answer === "NON_GCC") (conversation as any).non_gcc_handoff = true;
      await updateConversation(phone, { specs: vehicleUpdates.specs, car_conditions: (conversation as any).car_conditions,
        ...(answer === "NON_GCC" ? { non_gcc_handoff: true } : {}) } as any).catch(() => {});
    } else if (specClaim === "CHECK_MULKIYA" && currentStep < CLOSING_STEP) {
      // A claimed imported market is not verified non-GCC until this field is checked.
      const nextNotes = [notesForSpecs, "Mulkiya specs check pending"].filter(Boolean).join(" | ");
      await updateConversation(phone, { ...vehicleDbFields(vehicleUpdates), specs: "Unknown", car_conditions: nextNotes,
        last_msg_id: message.id, last_message_at: new Date().toISOString() } as any).catch(() => {});
      await sendWhatsAppMessage(phone, MULKIYA_QUESTION);
      await appendHistory(phone, (conversation.messages ?? []) as ConversationMessage[], messageText, MULKIYA_QUESTION);
      return NextResponse.json({ status: "mulkiya_check" }, { status: 200 });
    } else if (specClaim === "GCC" || specClaim === "Unknown") {
      vehicleUpdates.specs = specClaim;
    } else if (vehicleUpdates.specs === "Non-GCC" || vehicleUpdates.specs === "GCC") {
      // A model-generated spec without an explicit market statement is not evidence.
      vehicleUpdates.specs = "Unknown";
    }
    if (vehicleUpdates.specs === "Unknown") conversation.specs = "Unknown";

    const SPECS_UNSURE = /\b(i\s*don'?t\s*know|not\s*sure|no\s*idea|unsure|idk|not\s*sure\s*about|unclear)\b/i;
    const hasKnownSpecs = (vehicleUpdates.specs && vehicleUpdates.specs !== "Unknown")
                          || (conversation.specs && conversation.specs !== "Unknown");
    let specsExplicitlyUnknown = vehicleUpdates.specs === "Unknown"
      || (currentStep === 4 && !hasKnownSpecs && SPECS_UNSURE.test(messageText));
    // Loop guard: never ask the same question a third time — save "Unknown" and move on
    const histAssistant = ((conversation.messages ?? []) as ConversationMessage[]).filter(m => m.role === "assistant");
    const askedCount = (re: RegExp) => histAssistant.filter(m => re.test(m.content)).length;
    if (currentStep === 4) {
      if (!(vehicleUpdates.mileage || conversation.mileage) && askedCount(/\bmileage\b/i) >= 2) vehicleUpdates.mileage = "Unknown";
      if (!hasKnownSpecs && !specsExplicitlyUnknown && conversation.specs !== "Unknown" && askedCount(/GCC or non-GCC/i) >= 2) specsExplicitlyUnknown = true;
    }
    if (specsExplicitlyUnknown) vehicleUpdates.specs = "Unknown";

    let apptDate = conversation.appointment_date ?? "";
    let apptTime = conversation.appointment_time ?? "";
    let defaultedTime = false; // time picked by us (day given without a time)
    let apptFromMsg = false;   // this message gave a day and/or time
    let negatedDay = false;
    let altPhone: string | undefined;

    // Customer explicitly asks to book — from this message or earlier in the chat
    const BOOKING_INTENT = /\b(book|booking|appointment|inspection|inspect|schedule|come\s*(in|by|over)|bring\s*(the|my)?\s*car|visit\s*(you|your))\b/i;
    const priorUserMsgs = ((conversation.messages ?? []) as ConversationMessage[]).filter(m => m.role === "user").map(m => m.content);
    // A day + a time ("tomorrow 4pm", "today at 5", "monday morning") also means they want to come in
    const DAY = "(today|tonight|tomorrow|tmrw|tmr|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat)";
    const TIME = "(\\d{1,2}(:\\d{2})?\\s*(am|pm)|\\d{1,2}:\\d{2}|noon|morning|afternoon|evening|at\\s+\\d{1,2})";
    const DAY_TIME = new RegExp(`\\b${DAY}\\b.{0,25}\\b${TIME}|\\b${TIME}\\b.{0,25}\\b${DAY}\\b`, "i");
    const NOW_COME = /\b(come|coming|be there|drop by|pass by|visit|bring it)\b.{0,20}\b(now|right now|asap|in\s+(\d+|half an|an|one|a few)\s*(min|mins|minutes|hour|hours|hr|hrs))\b|\b(now|right now|asap)\b.{0,15}\b(come|coming|ok|fine)\b/i;
    const isBookingMsg = (t: string) => BOOKING_INTENT.test(t) || DAY_TIME.test(t) || NOW_COME.test(t);

    // "now" / "in 30 min" / "in an hour" → today at an actual time, if the branch is still open
    let nowSlot: { date: string; time: string } | null = null;
    {
      const m = messageText.match(/\b(right now|now|asap|in\s+(\d+|half an|an|one|a few)\s*(min|mins|minutes|hour|hours|hr|hrs))\b/i);
      if (m && (NOW_COME.test(messageText) || currentStep === FINAL_STEP)) {
        let addMin = 30;
        if (m[2]) {
          const qty = /half/i.test(m[2]) ? 0.5 : /an|one/i.test(m[2]) ? 1 : /few/i.test(m[2]) ? 3 : parseFloat(m[2]);
          addMin = /hour|hr/i.test(m[3]) ? qty * 60 : qty;
        }
        const d = new Date(Date.now() + 4 * 3600e3 + addMin * 60e3);
        const mins = Math.ceil((d.getUTCHours() * 60 + d.getUTCMinutes()) / 30) * 30;   // half-hour slots
        const dow = d.getUTCDay();
        const openM = dow === 5 ? 12 * 60 : 10 * 60;
        if (dow !== 0 && mins >= openM && mins <= 18 * 60 + 30) {
          nowSlot = { date: d.toISOString().slice(0, 10), time: `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}` };
        }
      }
    }
    const notesEarly = String((conversation as any).car_conditions ?? "");
    const noBookingCase = /(HIYAZA:|BUYER:|Multiple cars:|TRUCK\/BUS:|NOT A CAR:)/.test(notesEarly)
      || (((conversation as any).non_gcc_handoff === true || conversation.specs === "Non-GCC") && !String((conversation as any).car_conditions ?? "").includes("Non-GCC: booking offered"));
    // "call me after 6pm" / "call tomorrow morning" is about a phone call, not a visit
    const aboutCall = (t: string) => /\bcall(s|ed|ing)?\b/i.test(t) && !/\b(come|coming|book|visit|bring|inspection|drop)\b/i.test(t);
    const wantsBooking = !noBookingCase && currentStep >= 1 && currentStep < FINAL_STEP &&
      ((isBookingMsg(messageText) && !aboutCall(messageText) && !HOME_VISIT_PATTERN.test(messageText) && !/\bhome\s*(inspection|service|check)\b/i.test(messageText))
        || priorUserMsgs.some(t => isBookingMsg(t) && !aboutCall(t) && !HOME_VISIT_PATTERN.test(t) && !/\bhome\s*(inspection|service|check)\b/i.test(t)));

    // ── After booking: cancel or reschedule ───────────────────────────
    // Only a booking Kaya actually confirmed counts (a day saved while chatting is not a booking to change/cancel)
    const hasBooking = !!(conversation.appointment_date && conversation.appointment_time)
      && ((conversation.messages ?? []) as ConversationMessage[]).some(m => m.role === "assistant" && /you'?re booked for/i.test(m.content));
    // A short rejection of a proposed visit is ambiguous: offer the two existing paths once.
    // Keep this before the home-visit objection rule ("can't come this weekend" is about timing).
    if (!hasBooking && currentStep >= 6 && currentStep < CLOSING_STEP) {
      const lastA = [...((conversation.messages ?? []) as ConversationMessage[])].reverse().find(m => m.role === "assistant")?.content ?? "";
      const bookingQuestion = !!pendingBookingQ(lastA) || /\b(?:could you come|would (?:monday|tuesday|wednesday|thursday|friday|saturday|that day) work)\b/i.test(lastA);
      const vagueNo = /^\s*(?:no(?:\s+thanks)?|nope|nah|not interested)[.!\s]*$/i.test(messageText);
      const rejectsSuggestedDay = /\b(?:can'?t|cannot|won'?t|not able to)\s+come\b.{0,35}\b(?:this|next)\s+week\s*-?\s*end\b|\b(?:that|this) day (?:doesn'?t|does not|won'?t) work\b/i.test(messageText);
      if (bookingQuestion && (vagueNo || rejectsSuggestedDay)) {
        await sendWhatsAppMessage(phone, BOOKING_OR_TEAM_CHOICE);
        await updateConversation(phone, { appointment_date: null, appointment_time: null,
          last_msg_id: message.id, last_message_at: new Date().toISOString() } as any).catch(() => {});
        await appendHistory(phone, (conversation.messages ?? []) as ConversationMessage[], messageText, BOOKING_OR_TEAM_CHOICE);
        return NextResponse.json({ status: "booking_or_team_choice" }, { status: 200 });
      }
    }
    if (!hasBooking && currentStep >= 5 && currentStep < CLOSING_STEP
        && HOME_VISIT_PATTERN.test(messageText)
        && !/\b(i can|i will|i'?ll|we can|we will)\b.{0,30}\b(come|visit|bring)\b.{0,30}\b(branch|office|you)\b/i.test(messageText)) {
      const reply = `We do all inspections at our branch in Al Quoz. ${NOT_READY_CHOICE}`;
      const prev = String((conversation as any).car_conditions ?? "");
      await sendWhatsAppMessage(phone, reply);
      await updateConversation(phone, { ...vehicleDbFields(vehicleUpdates),
        car_conditions: [prev, "NOT READY YET: Cannot visit branch; call preference pending"].filter(Boolean).join(" | "),
        appointment_date: null, appointment_time: null, last_msg_id: message.id } as any);
      await appendHistory(phone, (conversation.messages ?? []) as ConversationMessage[], messageText, reply);
      await pushLead(phone, "cannot visit branch", { inspectionBooked: false, milestone: "FOLLOW UP", topNote: "NOT READY YET" });
      await moveLeadToCallBack(phone);
      return NextResponse.json({ status: "branch_visit_objection" }, { status: 200 });
    }
    // No booking requested: offer a personal call once. The lead goes into Call Back,
    // with no Bigin task (tasks are reserved for already-confirmed appointments).
    if (!hasBooking && currentStep >= 5 && currentStep < CLOSING_STEP) {
      const hist = (conversation.messages ?? []) as ConversationMessage[];
      const lastA = [...hist].reverse().find(m => m.role === "assistant")?.content ?? "";
      const answeringSellingAdvice = lastA.includes("Is a quick transfer with cash payment more important")
        && isSellingOptionAnswer(messageText);
      const isDeferred = !answeringSellingAdvice && (DEFER_PATTERN.test(messageText) || /\b(no need (to |for )?(a )?book(ing)?|not ready( to (book|sell))?|(don'?t|do not) (want|need) (to )?book|won'?t (book|come|visit)|maybe later|(i will|i'?ll) let (you|u) know)\b/i.test(messageText));
      const declinesCallback = /\b(no|don'?t|do not|not now|no thanks|no need)\b.{0,24}\b(call\s*back|callback|call|contact|follow[\s-]?up)\b|\b(call\s*back|callback|call|contact|follow[\s-]?up)\b.{0,20}\b(no thanks|not now|not needed)\b/i.test(messageText);
      const explicitBranchVisit = /\b(i can|i will|i'?ll|we can|we will)\b.{0,30}\b(come|visit|bring)\b.{0,30}\b(branch|office|you)\b/i.test(messageText);
      const answerToChoice = !explicitBranchVisit && (lastA.includes(NOT_READY_CHOICE) || lastA.includes("personal call from our team"));
      // A concrete day/time is a return to booking, even after a callback question.
      const resumesBooking = answerToChoice && !declinesCallback
        && !/\b(?:not|can'?t|cannot|won'?t|maybe|perhaps)\b/i.test(messageText)
        && (/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|tomorrow|today)\b/i.test(messageText)
          || /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(messageText));
      if ((isDeferred || answerToChoice || declinesCallback) && !resumesBooking) {
        const yes = !declinesCallback && /\b(yes|yeah|sure|please|call|contact|phone|team)\b/i.test(messageText) && !/^\s*(no|don'?t|not)\b/i.test(messageText);
        const no = declinesCallback || /^\s*(no|nope|nah|no thanks|not now|don'?t|not interested)\b/i.test(messageText);
        if (answerToChoice && !yes && !no) {
          const ask = "Just to confirm, would you like a personal call from our team, or would you prefer to contact us when you're ready?";
          await sendWhatsAppMessage(phone, ask);
          await appendHistory(phone, hist, messageText, ask);
          return NextResponse.json({ status: "not_ready_clarify" }, { status: 200 });
        }
        const note = answerToChoice && yes ? "NOT READY YET: Accepted personal call"
          : no ? "NOT READY YET: Declined personal call"
          : "NOT READY YET: Call preference pending";
        const previous = String((conversation as any).car_conditions ?? "").split(" | ").filter(n => !n.startsWith("NOT READY YET:"));
        const notes = [...previous, note].join(" | ");
        const closeNoCall = no && (answerToChoice || declinesCallback);
        const reply = answerToChoice && yes
          ? (isUAE ? "Thanks. Our team can contact you on this WhatsApp number. Have a nice day!" : `Thanks. ${POST_PHONE_Q}`)
          : closeNoCall
            ? "No problem. Whenever you're ready to sell your car, you're always welcome at Mister Wheelz. Here are our location and opening hours. Have a nice day!"
            : NOT_READY_CHOICE;
        await sendWhatsAppMessage(phone, reply);
        if (closeNoCall) {
          if (LOCATION_IMAGE_URL) await sendWhatsAppImage(phone, LOCATION_IMAGE_URL);
          await sendWhatsAppMessage(phone, LOCATION_TEXT);
        }
        await updateConversation(phone, { ...vehicleDbFields(vehicleUpdates), car_conditions: notes,
          step: answerToChoice || closeNoCall ? CLOSING_STEP : currentStep, appointment_date: null, appointment_time: null,
          last_msg_id: message.id, last_message_at: new Date().toISOString() } as any);
        await appendHistory(phone, hist, messageText, closeNoCall ? `${reply}\n[SPLIT]\n${LOCATION_TEXT}` : reply);
        await pushLead(phone, "not ready yet", { inspectionBooked: false,
          milestone: answerToChoice || closeNoCall ? undefined : "FOLLOW UP", topNote: "NOT READY YET" });
        await moveLeadToCallBack(phone);
        return NextResponse.json({ status: answerToChoice ? "not_ready_answer" : "not_ready_offer" }, { status: 200 });
      }
    }
    const CANCEL = /\b(cancel|already sold|sold it|sold the car|don'?t need (it|the appointment|the booking)|no need (for )?(the |a )?booking|not coming|won'?t (be )?com\w*|can'?t (make it|come)|call (it )?off)\b/i;
    const RESCHEDULE = /\b(reschedul\w*|change (the |my )?(time|date|appointment)|move (it|the appointment)|instead|another (time|day)|different (time|day)|postpone|earlier|later|can (we|i) (make it|do)|could do|make it)\b/i;
    const lastAssistantMsg = [...((conversation.messages ?? []) as ConversationMessage[])].reverse().find(m => m.role === "assistant")?.content ?? "";
    let completingNamedBooking = false;
    if (lastAssistantMsg.endsWith(POST_NAME_Q) && !hasBooking && conversation.appointment_date && conversation.appointment_time) {
      const n = extractNameFromMessage(messageText)
        ?? (/^[A-Za-z]{2,30}(?:\s+[A-Za-z]{2,30})?$/.test(messageText.trim()) && looksLikeName(messageText.trim()) ? nameCase(messageText.trim()) : null);
      if (!n) {
        await sendWhatsAppMessage(phone, POST_NAME_Q);
        await appendHistory(phone, (conversation.messages ?? []) as ConversationMessage[], messageText, POST_NAME_Q);
        return NextResponse.json({ status: "booking_name_clarify" }, { status: 200 });
      }
      (coreUpdates as any).name = n;
      conversation.name = n;
      completingNamedBooking = true;
    }
    const mentionsDayOrTime = new RegExp(`\\b${DAY}\\b|\\b${TIME}`, "i").test(messageText);
    // "I'm not coming for nothing / unless you answer" is a condition, not a cancellation
    const CONDITIONAL = /\b(unless|if|without|before|for nothing|until|otherwise)\b/i;
    const isCancel = currentStep >= FINAL_STEP && hasBooking && CANCEL.test(messageText) && !RESCHEDULE.test(messageText)
      && !/\b(but|instead|rather|can we|how about)\b/i.test(messageText)
      && !(CONDITIONAL.test(messageText) && !/\b(cancel|sold)\b/i.test(messageText));
    // A cancellation closes the old appointment. A reschedule closes the old slot;
    // the new slot is arranged by the call centre. Both receive a linked Bigin task.
    const CHANGE_ERROR = "Your request is recorded, but I couldn't create the team follow-up task. Please call us on 058 582 5543 to confirm the next step.";
    if (isCancel) {
      const task = await createChangeTask({ ...conversation, phone }, "CANCEL", messageText);
      const oldAppt = `${conversation.appointment_date} ${conversation.appointment_time}`;
      const saved = await updateConversation(phone, { step: CLOSING_STEP, appointment_date: null, appointment_time: null,
        appointment: null, car_conditions: [String((conversation as any).car_conditions ?? ""), `CANCELLED: ${oldAppt}; ${messageText.slice(0, 200)}`].filter(Boolean).join(" | "),
        last_msg_id: message.id, last_message_at: new Date().toISOString() } as any).then(() => true).catch(() => false);
      const answer = saved
        ? task.ok
          ? "Your inspection appointment has been cancelled as requested. Our call centre will follow up to reconfirm your decision; if you'd like to keep the appointment, please let them know."
          : `Your inspection appointment has been cancelled as requested. ${CHANGE_ERROR}`
        : "I received your cancellation request, but couldn't update the appointment. Please call us on 058 582 5543; the team will check it with you.";
      await sendWhatsAppMessage(phone, answer);
      await appendHistory(phone, (conversation.messages ?? []) as ConversationMessage[], messageText, answer);
      return NextResponse.json({ status: "cancel_task" }, { status: 200 });
    }
    // Reschedule: explicit change request after booking, or answering Kaya's reschedule question
    const timeInMsg = new RegExp(`\\b${TIME}`, "i").test(messageText);
    const dayWord   = messageText.match(new RegExp(`\\b${DAY}\\b`, "i"))?.[0];
    const satDow = conversation.appointment_date ? new Date(String(conversation.appointment_date) + "T12:00:00Z").getUTCDay() : -1;
    const differentDay = (!!dayWord && toIsoDate(dayWord) !== conversation.appointment_date)
      || (/\bweek\s*-?\s*end\b/i.test(messageText) && satDow !== 6);
    const GOODBYE = /\b(see you|thanks|thank you|great|perfect|cool|noted|got it)\b/i;
    // A day/time inside a longer question ("can the team confirm before tomorrow morning?") is not a new booking time
    const CHANGE_WORDS = /\b(come|coming|book|instead|change|move|switch|make it|can we do|how about|what about|better|rather)\b/i;
    // Mentioning the time they're already booked for ("I'll be there at 3pm") is not a change
    const timeStr = messageText.match(new RegExp(`\\b${TIME}`, "i"))?.[0];
    const sameTime = !!timeStr && toTime24(timeStr) != null && toTime24(timeStr) === toTime24(String(conversation.appointment_time ?? ""));
    // A day/time mentioned after a booking is only a change request with change words, or as a very short reply
    // ("Thursday 3pm"); "my father can sign before Tuesday evening" is not a reschedule
    const STRICT_CHANGE = /\b(instead|change|move|switch|make it|can we do|how about|what about|better|rather|reschedul\w*|postpone|shift)\b|\bonly\b.{0,20}\b(come|make it|available|free)\b|\bcan'?t (come|make it)\b|\bnot available\b/i;
    const newDayOrTime = ((timeInMsg && !sameTime) || differentDay) && !GOODBYE.test(messageText)
      && (messageText.trim().split(/\s+/).length <= 4 || STRICT_CHANGE.test(messageText));
    // Chat closed without a booking (e.g. after a team handoff) and they now want to come in → book it,
    // except for cases that never get an appointment (Hiyaza, buyer-only, multiple cars, non-GCC)
    const notesNow = String((conversation as any).car_conditions ?? "");
    const bookingAllowed = !/(HIYAZA:|BUYER:|Multiple cars:|TRUCK\/BUS:)/.test(notesNow)
      && ((String((conversation as any).car_conditions ?? "").includes("Non-GCC: booking offered")) || ((conversation as any).non_gcc_handoff !== true && conversation.specs !== "Non-GCC"));
    const bookFromClosed = currentStep >= CLOSING_STEP && !hasBooking && bookingAllowed && isBookingMsg(messageText);
    const plainQuestion = /\?/.test(messageText) && !/\b(change|move|reschedul\w*|instead|another (time|day)|different (time|day)|postpone|can we (do|make it)|earlier|later)\b/i.test(messageText);
    const wantsReschedule = !noBookingCase && !aboutCall(messageText) && currentStep >= CLOSING_STEP && hasBooking && !plainQuestion &&
      (RESCHEDULE.test(messageText) || newDayOrTime);
    if (wantsReschedule) {
      const task = await createChangeTask({ ...conversation, phone }, "RESCHEDULE", messageText);
      const oldAppt = `${conversation.appointment_date} ${conversation.appointment_time}`;
      const saved = await updateConversation(phone, { step: CLOSING_STEP, appointment_date: null, appointment_time: null,
        appointment: null, car_conditions: [String((conversation as any).car_conditions ?? ""), `RESCHEDULE REQUESTED: old ${oldAppt}; requested ${messageText.slice(0, 200)}`].filter(Boolean).join(" | "),
        last_msg_id: message.id, last_message_at: new Date().toISOString() } as any).then(() => true).catch(() => false);
      const answer = saved
        ? task.ok
          ? "Your request to reschedule is confirmed, and your previous appointment time has been released. Our call centre will contact you to confirm the new date and time."
          : `Your previous appointment time has been released. ${CHANGE_ERROR}`
        : "I received your rescheduling request, but couldn't update the appointment. Please call us on 058 582 5543; the team will check it with you.";
      await sendWhatsAppMessage(phone, answer);
      await appendHistory(phone, (conversation.messages ?? []) as ConversationMessage[], messageText, answer);
      return NextResponse.json({ status: "reschedule_task" }, { status: 200 });
    }
    // Questions requiring staff action about an existing appointment are tasks as well.
    const simpleBookingQuestion = /\b(location|address|where are you|map|directions?|opening|hours|what time (do you|are you) (open|close)|free inspection|inspection free)\b/i.test(messageText);
    if (hasBooking && currentStep >= CLOSING_STEP && !simpleBookingQuestion
        && /\b(my|the)\s+(booking|appointment|inspection)\b/i.test(messageText)
        && /\b(call|contact|confirm|check|question|issue|problem|inquiry|ask the team|help)\b/i.test(messageText)) {
      const task = await createChangeTask({ ...conversation, phone }, "OTHER", messageText);
      const answer = task.ok ? "Your appointment inquiry is recorded. Our call centre will follow up with you; your appointment is still booked." : CHANGE_ERROR;
      await sendWhatsAppMessage(phone, answer);
      await updateConversation(phone, { last_msg_id: message.id, last_message_at: new Date().toISOString() } as any).catch(() => {});
      await appendHistory(phone, (conversation.messages ?? []) as ConversationMessage[], messageText, answer);
      return NextResponse.json({ status: "booking_inquiry_task" }, { status: 200 });
    }
    const isRebook = bookFromClosed;
    const visitWindow = !hasBooking && currentStep >= 6 && currentStep <= FINAL_STEP
      && !/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(messageText)
      ? visitAvailability(messageText) : null;
    if (visitWindow?.date) {
      await updateConversation(phone, { appointment_date: visitWindow.date, appointment_time: null } as any).catch(() => {});
      (conversation as any).appointment_date = visitWindow.date;
    }

    const answeringSellingOption = lastAssistantMsg.includes("Is a quick transfer with cash payment more important")
      && isSellingOptionAnswer(messageText);
    const deferring = !answeringSellingOption && DEFER_PATTERN.test(messageText) && !/\b(\d{1,2}(:\d{2})?\s*(am|pm)|\d{1,2}:\d{2})\b/i.test(messageText)
      && !new RegExp(`\\b${DAY}\\b|\\bweek\\s*-?\\s*end\\b`, "i").test(messageText);
    // Not a clear day/time: undecided, vague window, location only, walk-in, depends on someone, a day with
    // "maybe", or far away (Marc, 13 Oct) → handled with fixed replies below, never booked from this message.
    // Plain "this week" / "next week" at the when-to-sell question keeps Marc's own reply.
    const plainWeek = currentStep <= 6 && /\b(this|next)\s+week\b/i.test(messageText) && !/\b(later|sometime|maybe|end of)\b/i.test(messageText);
    const timing = (currentStep >= 5 && currentStep < CLOSING_STEP && !hasBooking && !plainWeek && !answeringSellingOption) ? classifyTiming(messageText, DEFER_PATTERN) : null;
    if (timing) console.log(`[kaya] timing ${timing.kind} for ${phone}`);
    if ((currentStep === FINAL_STEP || wantsBooking || isRebook) && messageText && !deferring && !timing && !visitWindow) {
      try {
        const ea = await extractAppointment(messageText);
        if (nowSlot) { ea.appointment_date = nowSlot.date; ea.appointment_time = nowSlot.time; }
        // Store the real date ("tomorrow" → "2026-10-10") so it stays correct later
        // "Today not possible" / "not tomorrow" / "can't on Monday" → that day is NOT the booking day
        {
          const NEG = /\b(not possible|not today|today not|not tomorrow|tomorrow not|can'?t|cannot|not available|not free|busy|no time)\b/i;
          const dayWords = (messageText.match(new RegExp(`\\b${DAY}\\b`, "gi")) ?? []).length;
          if (NEG.test(messageText) && dayWords <= 1 && !/\b(but|instead|rather|only)\b/i.test(messageText)) {
            ea.appointment_date = ""; ea.appointment_time = "";
            negatedDay = true;
          }
        }
        // "weekend" → Saturday (closed on Sunday); also when "Weekend" was saved earlier as the day
        const nextSaturday = () => {
          const n = new Date(Date.now() + 4 * 3600e3);
          let add = (6 - n.getUTCDay() + 7) % 7;
          if (add === 0 && n.getUTCHours() >= 18) add = 7;
          return new Date(n.getTime() + add * 86400e3).toISOString().slice(0, 10);
        };
        if (/\bweek\s*-?\s*end\b/i.test(String(ea.appointment_date ?? "")) || (!ea.appointment_date && /\bweek\s*-?\s*end\b/i.test(messageText))) ea.appointment_date = nextSaturday();
        // An AI extractor can reduce "after tomorrow" to "tomorrow". The customer's
        // actual wording takes precedence so the appointment stays two days out.
        if (/\b(?:the\s+)?day\s+after\s+tomorrow\b|\bafter\s+tomorrow\b/i.test(messageText))
          ea.appointment_date = toIsoDate("after tomorrow") ?? ea.appointment_date;
        if (conversation.appointment_date && /week\s*-?\s*end/i.test(String(conversation.appointment_date))) (conversation as any).appointment_date = nextSaturday();
        // "In the afternoon" after "tomorrow" must not move the day back to today: without a day word
        // (or a date) in this message, the day already agreed stays
        const dayInMsg = new RegExp(`\\b${DAY}\\b|\\b\\d{1,2}(st|nd|rd|th)\\b|\\b\\d{1,2}[/.-]\\d{1,2}\\b|\\b(jan|feb|mar|apr|june?|july?|aug|sep|oct|nov|dec)[a-z]*\\b|\\bnext week\\b`, "i").test(messageText);
        if (ea.appointment_date && conversation.appointment_date && !dayInMsg) ea.appointment_date = conversation.appointment_date;
        if (ea.appointment_date) apptDate = toIsoDate(ea.appointment_date) ?? ea.appointment_date;
        // The appointment extractor can invent a clock time for "tomorrow afternoon".
        // Keep the day but treat a period-only answer as having no exact time.
        const statedClock = /\b\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm|o'?clock|h\d{2})\b|\b(?:at|after|before|around)\s+\d{1,2}\b|^\s*\d{1,2}(?:[:.]\d{2})?\s*$/i.test(messageText);
        if (!statedClock && /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|morning|afternoon|after noon|evening|weekend)\b/i.test(messageText)) {
          ea.appointment_time = "";
          apptTime = "";
        }
        if (ea.appointment_time) {
          // Half-hour slots (10:00, 10:30 … 6:30 PM): an in-between time goes to the next slot
          const t = toTime24(ea.appointment_time);
          if (t) {
            const m = +t.slice(0, 2) * 60 + +t.slice(3);
            const r = Math.ceil(m / 30) * 30;
            apptTime = `${String(Math.floor(r / 60)).padStart(2, "0")}:${String(r % 60).padStart(2, "0")}`;
            ea.appointment_time = apptTime;
          } else apptTime = ea.appointment_time;
        }
        // "anytime after 2" / "after 4pm" → the first slot after that time (2:30 PM / 4:30 PM)
        {
          const am = messageText.match(/\bafter\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
          if (am) {
            let h = parseInt(am[1], 10); const m = am[2] ? parseInt(am[2], 10) : 0;
            if (!am[3] && h >= 1 && h <= 7) h += 12; else if (am[3]?.toLowerCase() === "pm" && h < 12) h += 12;
            const mins = Math.ceil((h * 60 + m + 1) / 30) * 30;
            if (mins >= 10 * 60 && mins <= 18 * 60 + 30) {
              apptTime = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
              ea.appointment_time = apptTime;
              if (!apptDate) { const inf = inferApptDate(apptTime, lastAssistantMsg); if (inf) { apptDate = inf; ea.appointment_date = inf; } }
            }
          }
        }
        // Day without a time ("On 16th or 17th I can come") → book 12:15 PM by default (Marc)
        // …or 1:15 / 2:15 PM etc. when that time is already taken (Marc)
        // "in the afternoon" / "morning" without a clock time → a free slot in that part of the day
        if (apptTime && !toTime24(apptTime) && !/\b(now|right now|asap|soon)\b/i.test(apptTime)) { apptTime = ""; ea.appointment_time = undefined as any; }
        if (ea.appointment_date || ea.appointment_time) apptFromMsg = true;
        const dayPart = (messageText.match(/\b(morning|afternoon|evening)\b/i)?.[1]?.toLowerCase()) as "morning" | "afternoon" | "evening" | undefined;
        if (apptTime && !toTime24(apptTime) && /\b(morning|afternoon|evening|noon)\b/i.test(apptTime)) { apptTime = ""; ea.appointment_time = undefined as any; }
        // "The earliest possible" / "first slot" once a day is known → the first free morning slot that day
        if (!apptTime && /\b(earliest|soonest|quickest|as (early|quick|quickly|soon|fast) as possible|first (slot|thing|available)|early morning|asap)\b/i.test(messageText)) {
          const knownDay = (apptDate && /^\d{4}-\d{2}-\d{2}$/.test(apptDate)) ? apptDate
            : (conversation.appointment_date && /^\d{4}-\d{2}-\d{2}$/.test(String(conversation.appointment_date)) ? String(conversation.appointment_date) : "");
          const todayIso = new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
          if (knownDay && knownDay >= todayIso) {
            apptDate = knownDay; ea.appointment_date = knownDay;
            apptTime = await pickDefaultTime(knownDay, phone, "morning"); ea.appointment_time = apptTime;
            apptFromMsg = true;
          }
        }
        // A question ("can I come today?") gets a time question, not a default slot
        if (apptDate && !apptTime && !ea.appointment_time && /^\d{4}-\d{2}-\d{2}$/.test(apptDate) && !/\?/.test(messageText)) {
          // Only our explicit second request counts. A general "what time is best?"
          // followed by "Saturday morning" must get one more chance to name a time.
          const askedExactTime = /what exact time would you prefer on that day\?/i.test(lastAssistantMsg);
          if (askedExactTime) {
            apptTime = await pickDefaultTime(apptDate, phone, dayPart); ea.appointment_time = apptTime;
            defaultedTime = true;
          }
        }
        // Time without a day ("5pm" in reply to "What time can you come in this afternoon?") → infer the
        // day from Kaya's question, so the booking never ends up with a time but no date.
        // …but a day already agreed ("tomorrow", then "in the afternoon") always wins
        const todayIsoNow = new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
        if (!apptDate && apptTime && conversation.appointment_date && /^\d{4}-\d{2}-\d{2}$/.test(String(conversation.appointment_date)) && String(conversation.appointment_date) >= todayIsoNow) {
          apptDate = String(conversation.appointment_date); ea.appointment_date = apptDate;
        }
        if (!apptDate && apptTime && toTime24(apptTime)) {
          const inferred = inferApptDate(toTime24(apptTime)!, lastAssistantMsg);
          if (inferred) { apptDate = inferred; ea.appointment_date = inferred; }
        }
        const apptSave: Partial<Conversation> = {};
        if (ea.appointment_date) apptSave.appointment_date = apptDate;
        if (ea.appointment_time) apptSave.appointment_time  = ea.appointment_time;
        if (Object.keys(apptSave).length > 0)
          await updateConversation(phone, apptSave);
        if (apptDate && !apptTime && currentStep >= 6 && !/\?/.test(messageText)
            && !/what exact time would you prefer on that day\?/i.test(lastAssistantMsg)) {
          const ask = "What exact time would you prefer on that day?";
          await sendWhatsAppMessage(phone, ask);
          await updateConversation(phone, { step: FINAL_STEP, appointment_date: apptDate,
            last_msg_id: message.id, last_message_at: new Date().toISOString() } as any);
          await appendHistory(phone, (conversation.messages ?? []) as ConversationMessage[], messageText, ask);
          return NextResponse.json({ status: "ask_exact_time" }, { status: 200 });
        }
      } catch (e) {
        console.error("early appointment extraction error:", e);
      }
      // "Tuesday 10 am" said on a Tuesday after 10 am (or after "next week") means NEXT Tuesday, not today
      {
        const rolled = rollSameWeekday(String(apptDate || ""), messageText, String(apptTime || conversation.appointment_time || ""),
          ((conversation.messages ?? []) as ConversationMessage[]).filter(m => m.role === "user").map(m => m.content));
        if (rolled && rolled !== String(apptDate || "")) {
          apptDate = rolled;
          await updateConversation(phone, { appointment_date: apptDate } as any).catch(() => {});
          console.log(`[kaya] same weekday → next week ${apptDate} for ${phone}`);
        }
      }
      // "Shall I book you for Thursday 15th…?" → "after 3 PM" / "4pm" / "afternoon" keeps THAT day
      {
        const offerDay = lastAssistantMsg.match(/Shall I book you for \w+ (\d{1,2})(?:st|nd|rd|th) of (\w+) at/i);
        const dayHere = new RegExp(`\\b${DAY}\\b`, "i").test(messageText);
        // …or the customer named the day in their previous message ("Maybe Thursday" → "after 3 PM")
        const prevUser = [...((conversation.messages ?? []) as ConversationMessage[])].reverse().find(m => m.role === "user" && m.content !== messageText)?.content ?? "";
        const prevDayW = prevUser.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday)\b/i)?.[1];
        const timeHere = /\b(after|before|around|at)\s+\d{1,2}|\b\d{1,2}(:\d{2})?\s*(am|pm)\b|\b(morning|afternoon|evening)\b/i.test(messageText);
        const carryIso = offerDay ? toIsoDate(`${offerDay[1]} ${offerDay[2]}`)
          : (prevDayW && timeHere && !/You're booked for/i.test(lastAssistantMsg)) ? toIsoDate(prevDayW) : null;
        const isQuestion = /\?|^\s*(what|when|how|do|does|are|is|can|which|where|till|until)\b/i.test(messageText);
        if (carryIso && !dayHere && !isQuestion) {
          const d = carryIso;
          if (d) {
            apptDate = d;
            let t: string | null = null;
            const after = messageText.match(/\bafter\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
            if (after) { let h = +after[1]; if (!after[3] && h >= 1 && h <= 7) h += 12; else if (after[3]?.toLowerCase() === "pm" && h < 12) h += 12; t = `${String(h).padStart(2, "0")}:15`; }
            else { const t24 = toTime24(String(messageText.match(/\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i)?.[0] ?? "")); if (t24) t = t24; }
            if (t) { apptTime = t; apptFromMsg = true; defaultedTime = false; await updateConversation(phone, { appointment_date: d, appointment_time: t } as any).catch(() => {}); }
          }
        }
      }
      // "Shall I book you for Saturday 17th of October at 12:15 PM?" → "yes" books exactly that
      {
        const offer = lastAssistantMsg.match(/Shall I book you for \w+ (\d{1,2})(?:st|nd|rd|th) of (\w+) at (\d{1,2}:\d{2} [AP]M)/i);
        if (offer && /^\s*(yes|yeah|yep|ya|ok|okay|sure|please|pls|book( it)?|go ahead|fine|perfect|confirm|done|👍)\b/i.test(messageText)) {
          const d = toIsoDate(`${offer[1]} ${offer[2]}`); const t = toTime24(offer[3]);
          if (d && t) { apptDate = d; apptTime = t; apptFromMsg = true; defaultedTime = false; await updateConversation(phone, { appointment_date: d, appointment_time: t } as any).catch(() => {}); }
        }
      }

      // Capture alternative phone number if customer provides one at booking step
      const phoneMatch = messageText.match(/(?:\+?971|00971|0)?\s*5\d[\s-]?\d{3}[\s-]?\d{4}/);
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
    const loanIsYes  = !/\b(no|none|not|don'?t|do not|without|paid off|clear|cash purchase)\b/i.test(loanAnswer)
      && /\byes\b|\bi do\b|\bhave (a |an )?(loan|mortgage)|there is|outstanding|lease to own/i.test(loanAnswer);
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

    if (currentStep === 5 && loanIsYes && !mortgageAmount && !conversation.mortgage_amount && askedCount(/outstanding balance/i) >= 2) {
      mortgageAmount = "Unknown";
    }
    // A loan answer can arrive after Kaya has already moved on to the booking question.
    if (currentStep > 5 && /\b(loan|mortgage|finance|financed|lease to own|remaining|outstanding|balance)\b/i.test(messageText)) {
      const amt = messageText.match(/\b(\d{1,3}(?:[,.]\d{3})+|\d+(?:\.\d+)?)\s*(k|thousand|m|million)?\b/i);
      if (amt && /\b(remaining|outstanding|balance|loan|mortgage|finance|lease)\b/i.test(messageText)) {
        const n = parseFloat(amt[1].replace(/[,.](?=\d{3}\b)/g, ""));
        mortgageAmount = String(Math.round(n * (/^(k|thousand)$/i.test(amt[2] ?? "") ? 1000 : /^(m|million)$/i.test(amt[2] ?? "") ? 1_000_000 : 1)));
      }
      if (/\b(lease to own|loan|mortgage|remaining|outstanding)\b/i.test(messageText) && !/\b(no|none|not|don'?t|without|paid off)\b/i.test(messageText)) {
        await updateConversation(phone, { loan: "Yes" } as any).catch(() => {});
      }
      const previous = String((conversation as any).car_conditions ?? "");
      const note = `Finance detail: ${messageText.trim().slice(0, 180)}`;
      if (!previous.includes(note)) await updateConversation(phone, { car_conditions: [previous, note].filter(Boolean).join(" | ") } as any).catch(() => {});
    }

    const carYear    = parseInt((vehicleUpdates.year ?? conversation.year) || "0");
    const carMileage = vehicleUpdates.mileage ?? conversation.mileage;
    const carSpecs   = (vehicleUpdates.specs && vehicleUpdates.specs !== "Unknown")
                         ? vehicleUpdates.specs
                         : (conversation.specs && conversation.specs !== "Unknown" ? conversation.specs : null);
    const currentYear = new Date().getFullYear();
    const hasAllVehicleFields = !!carMileage && (!!carSpecs || specsExplicitlyUnknown
                                  || conversation.specs === "Unknown");
    const skipLoan = currentStep === 4 && hasAllVehicleFields && carYear > 0 && carYear < 2020; // Marc: mortgage only for 2020+

    // ── Number given after a callback promise (chat closed) → save it ─────────
    if (currentStep >= CLOSING_STEP) {
      const lastA = [...((conversation.messages ?? []) as ConversationMessage[])].reverse().find(m => m.role === "assistant")?.content ?? "";
      if (/best (number )?to reach you/i.test(lastA)) {
        const pm = messageText.match(/(?:\+?971|00971|0)?\s*5\d[\s-]?\d{3}[\s-]?\d{4}/);
        if (pm) {
          const raw = pm[0].replace(/\D/g, "");
          const alt = raw.startsWith("971") ? raw : `971${raw.replace(/^0/, "")}`;
          if (alt !== phone) await updateConversation(phone, { alternative_phone: alt } as any).catch(() => {});
        }
      }
    }

    // ── Competitor offer ("Carswitch offered me 120k") → notes, marked unverified ──
    {
      const cm = messageText.match(/\b(carswitch|cars24|dubizzle|alba|emirates auction|cartrade|kavak|another (company|buyer|dealer|showroom)|other (companies|company|buyers|buyer|dealers|dealer|showrooms?)|they|someone|a dealer|a showroom)\b.{0,40}?\b(offered|offer|gave|quoted|pay|paying|said)\b.{0,20}?(\d[\d,.]*\s*(k|thousand)?)/i);
      if (cm) {
        const raw = cm[5].replace(/,/g, "").trim();
        let n = parseFloat(raw); if (/k|thousand/i.test(raw)) n *= 1000;
        const isYear = !/k|thousand/i.test(raw) && /^(19[89]\d|20[0-3]\d)$/.test(raw);
        if (n >= 1000 && !isYear) {
          const note = `Competitor offer (customer says, unverified): AED ${Math.round(n).toLocaleString("en-US")} — ${cm[1]}`;
          const ex = String((conversation as any).car_conditions ?? "").split(" | ").filter(x => x && !x.startsWith("Competitor offer"));
          const upd = [...ex, note].join(" | ");
          (conversation as any).car_conditions = upd;
          await updateConversation(phone, { car_conditions: upd } as any).catch(() => {});
        }
      }
    }

    // ── Expected price ("I want at least 180k") → notes for the team ─────────
    {
      const ep = messageText.match(/\b(want|expect|expecting|looking for|asking|need|at least|minimum|min|not less than|no less than)\b[^0-9]{0,20}(\d[\d,.]*\s*(k|thousand)?)\s*(aed|dhs|dirhams?)?/i);
      const aboutLoan = /\b(bank|loan|owe|owing|mortgage|finance|financed|pay\s*off|payoff|outstanding|balance|installments?|emi)\b/i.test(messageText);
      if (ep && !aboutLoan) {
        let raw = ep[2].replace(/,/g, "").trim();
        let n = parseFloat(raw);
        const isMoneyMarked = /k|thousand/i.test(raw) || !!ep[4];
        if (/k|thousand/i.test(raw)) n *= 1000;
        const looksLikeYear = !isMoneyMarked && /^(19[89]\d|20[0-3]\d)$/.test(raw);
        if (n >= 1000 && !looksLikeYear) {
          const note = `Customer expects: AED ${Math.round(n).toLocaleString("en-US")}`;
          const ex = String((conversation as any).car_conditions ?? "").split(" | ").filter(x => !x.startsWith("Customer expects:"));
          const upd = [...ex, note].filter(Boolean).join(" | ");
          (conversation as any).car_conditions = upd;
          await updateConversation(phone, { car_conditions: upd } as any).catch(() => {});
        }
      }
    }

    // ── Not a car (motorbike, truck, boat…) → we only buy cars ──
    // Only intercepts before a car is known; once a car is in the chat, Claude answers per the prompt rule.
    {
      const NOT_CAR = /\b(motor ?bikes?|motor ?cycles?|bikes?|scooters?|quad ?bikes?|atvs?|buggy|buggies|jet ?skis?|boats?|yachts?|speed ?boats?|trailers?|caravans?|forklifts?|tractors?|excavators?|harley|ducati|yamaha|kawasaki|ktm|vespa|royal enfield)\b/i;
      const NC_LINE = "Sorry, we only buy cars. We don't buy motorbikes, boats or similar vehicles.";
      if (!conversation.make && NOT_CAR.test(messageText) && currentStep < CLOSING_STEP) {
        const hist = (conversation.messages ?? []) as ConversationMessage[];
        const reply = `${NC_LINE} If you have a car to sell in the future, we're happy to help!`;
        const ex = String((conversation as any).car_conditions ?? "");
        const note = "NOT A CAR: customer wanted to sell a non-car vehicle — declined";
        await sendWhatsAppMessage(phone, reply);
        await updateConversation(phone, { step: CLOSING_STEP, car_conditions: ex.includes("NOT A CAR:") ? ex : (ex ? `${ex} | ${note}` : note), last_msg_id: message.id, last_message_at: new Date().toISOString() } as any).catch(e => console.error("not-car save error:", e));
        await appendHistory(phone, hist, messageText, reply);
        return NextResponse.json({ status: "not_a_car" }, { status: 200 });
      }
    }

    // ── Answer to "Which UAE number…?" that isn't a phone number (e.g. a plate "Dubai X68212") → ask once more ──
    if (/best (number )?to reach you/i.test(lastAssistantMsg) && currentStep < CLOSING_STEP + 1) {
      const hasPhone = /(?:\+?971|00971|\b0)\s*5\d[\s-]?\d{3}[\s-]?\d{4}\b|\b5\d{8}\b/.test(messageText)
        || /(?:\+|\b00)\d[\d\s-]{7,16}\d/.test(messageText);   // foreign numbers (+44 …, 0044 …) are fine too
      const pointsToThis = /\b(this|same|that|here|current|whatsapp|yes|yeah|yep|ok|okay|sure|it'?s fine|use (it|this))\b/i.test(messageText);
      const looksLikePlate = /\b(dubai|dxb|abu dhabi|auh|sharjah|shj|ajman|rak|fujairah|uaq)\b.{0,6}\b[a-z]{0,2}\s*\d{2,5}\b|^\s*[a-z]{1,2}\s*\d{3,5}\s*$/i.test(messageText);
      const alreadyAskedAgain = /that looks like a plate number|mobile number is best/i.test(lastAssistantMsg);
      if (!hasPhone && !pointsToThis && !alreadyAskedAgain && (looksLikePlate || /\d{3,}/.test(messageText))) {
        const ask = looksLikePlate
          ? "Thanks, that looks like a plate number. Which UAE mobile number is best to reach you on? If it's this WhatsApp number, just say \"this one\"."
          : "Which UAE mobile number is best to reach you on? If it's this WhatsApp number, just say \"this one\".";
        await sendWhatsAppMessage(phone, ask);
        const hist0 = (conversation.messages ?? []) as ConversationMessage[];
        await updateConversation(phone, { last_msg_id: message.id, ...(looksLikePlate ? { car_conditions: [String((conversation as any).car_conditions ?? ""), `Plate: ${messageText.slice(0, 30)}`].filter(Boolean).join(" | ") } : {}) } as any).catch(() => {});
        await appendHistory(phone, hist0, messageText, ask);
        return NextResponse.json({ status: "phone_clarify" }, { status: 200 });
      }
    }

    // ── Answers to the after-booking questions (name, then number for non-UAE) ──
    if (currentStep >= CLOSING_STEP && (lastAssistantMsg.endsWith(POST_NAME_Q) || lastAssistantMsg.endsWith(POST_PHONE_Q))) {
      const hist0 = (conversation.messages ?? []) as ConversationMessage[];
      const upd: Record<string, unknown> = { last_msg_id: message.id, last_message_at: new Date().toISOString() };
      let nextQ: string | null = null;
      let nm = conversation.name;
      // A question instead of the answer ("Are there charges for inspection?") → answer it first,
      // then ask the same question again (Marc: never skip the customer's question)
      const pendingQ = lastAssistantMsg.endsWith(POST_NAME_Q) ? POST_NAME_Q : POST_PHONE_Q;
      if (/\?\s*$|\b(how|what|where|why|when|is there|are there|do you|do i|can i|will you)\b/i.test(messageText) && !/\d{7,}/.test(messageText.replace(/\D/g, ""))) {
        const FEES = /\b(charge|charges|fee|fees|cost|pay|commission|free)\b/i;
        let answer = FEES.test(messageText)
          ? "There's no commission and no fees. The quick inspection is free."
          : await getKayaReply(CLOSING_STEP, hist0, messageText, { name: conversation.name ?? undefined, appointment_date: conversation.appointment_date ?? undefined, appointment_time: conversation.appointment_time ?? undefined } as any).catch(() => "");
        answer = answer.replace(/\s*(Have a nice (day|evening)|See you (later|tomorrow|soon))[^!]*!/gi, "").trim();
        const parts = [answer, pendingQ].filter(Boolean);
        for (const p of parts) await sendWhatsAppMessage(phone, p);
        await updateConversation(phone, upd as any).catch(() => {});
        await appendHistory(phone, hist0, messageText, parts.join("\n[SPLIT]\n"));
        return NextResponse.json({ status: "post_booking_question" }, { status: 200 });
      }
      if (lastAssistantMsg.endsWith(POST_NAME_Q)) {
        const n = extractNameFromMessage(messageText) ?? (/^[A-Za-z]{2,15}(\s+[A-Za-z]{2,15})?$/.test(messageText.trim()) && looksLikeName(messageText.trim()) ? nameCase(messageText.trim()) : null);
        if (n) { upd.name = n; nm = n; }
        if (!isUAE) nextQ = POST_PHONE_Q;
      } else {
        const pm = messageText.match(/(?:\+|00)?\d[\d\s-]{7,15}\d/);
        if (pm) upd.alternative_phone = pm[0].replace(/\D/g, "").replace(/^00/, "");
      }
      const reply = nextQ ?? `Thanks! ${bookingGoodbye(nm, conversation.appointment_date)}`;
      await sendWhatsAppMessage(phone, reply);
      await updateConversation(phone, upd as any).catch(() => {});
      await appendHistory(phone, hist0, messageText, reply);
      if (upd.name || upd.alternative_phone) await pushLead(phone, "details after booking", { inspectionBooked: true });
      return NextResponse.json({ status: "post_booking_details" }, { status: 200 });
    }

    // ── Chat finished and the customer only says "ok / thanks" → no reply (never repeat the closing) ──
    if (currentStep >= CLOSING_STEP && /^(\s*(ok(ay)?|k|thanks?|thank you|so much|thx|ty|great|perfect|noted|cool|sure|alright|fine|good|done|see you|bye|👍|🙏|👌|❤️|shukran)[\s,.!🙏👍]*)+$/i.test(messageText)) {
      const hist0 = (conversation.messages ?? []) as ConversationMessage[];
      await updateConversation(phone, { last_msg_id: message.id, messages: [...hist0, { role: "user", content: messageText }].slice(-40), last_message_at: new Date().toISOString() } as any).catch(() => {});
      return NextResponse.json({ status: "ack_no_reply" }, { status: 200 });
    }

    // ── Truck / bus → allowed, but straight to the team for filtering (no booking) ──
    {
      const TRUCK = /\b(lorry|lorries|buses|bus|minibus|mini bus|coaster|(?<!(recovery|tow|pickup|pick-up|pick up) )trucks?)\b/i;
      const TB_LINE = "For trucks and buses, our team will contact you directly.";
      const TB_CAR_Q = "Could you share the make, model, year and mileage?";
      const TB_NAME_Q = "May I have your name?";
      const TB_PHONE_Q = "Which UAE number is best to reach you on?";
      const hist = (conversation.messages ?? []) as ConversationMessage[];
      const notesTB = String((conversation as any).car_conditions ?? "");
      const inTb = hist.some(m => m.role === "assistant" && m.content.includes(TB_LINE)) || notesTB.includes("TRUCK/BUS:");
      if ((inTb || (!conversation.make && TRUCK.test(messageText))) && currentStep < CLOSING_STEP) {
        const lastA = [...hist].reverse().find(m => m.role === "assistant")?.content ?? "";
        const upd: Record<string, unknown> = { last_msg_id: message.id, last_message_at: new Date().toISOString() };
        let name = conversation.name;
        let notes = notesTB;
        if (!inTb) notes = notes ? `${notes} | TRUCK/BUS: ${messageText.slice(0, 200)}` : `TRUCK/BUS: ${messageText.slice(0, 200)}`;
        if (inTb && lastA.includes(TB_CAR_Q)) notes = `${notes} | Vehicle details: ${messageText.slice(0, 200)}`;
        if (inTb && lastA.includes(TB_NAME_Q) && !name) {
          const n = extractNameFromMessage(messageText);
          if (n) { upd.name = n; name = n; }
        }
        if (inTb && lastA.includes(TB_PHONE_Q)) {
          const pm = messageText.match(/(?:\+?971|00971|0)?\s*5\d[\s-]?\d{3}[\s-]?\d{4}/);
          if (pm) {
            const raw = pm[0].replace(/\D/g, "");
            const alt = raw.startsWith("971") ? raw : `971${raw.replace(/^0/, "")}`;
            if (alt !== phone) upd.alternative_phone = alt;
          }
        }
        upd.car_conditions = notes;
        const asked = (q: string) => hist.some(m => m.role === "assistant" && m.content.includes(q));
        const nextQ = !asked(TB_CAR_Q) ? TB_CAR_Q : !name && !asked(TB_NAME_Q) ? TB_NAME_Q : !isUAE && !asked(TB_PHONE_Q) ? TB_PHONE_Q : null;
        const reply = !inTb
          ? `Thanks for letting me know. ${TB_LINE} ${nextQ ?? ""}`.trim()
          : nextQ ?? `Thanks! Our team will contact you ${teamWhen()}. Have a nice day!`;
        if (!nextQ && inTb) upd.step = CLOSING_STEP;
        await sendWhatsAppMessage(phone, reply);
        await updateConversation(phone, upd as any).catch(e => console.error("truck/bus save error:", e));
        await appendHistory(phone, hist, messageText, reply);
        if (!inTb || !nextQ) await pushLead(phone, !inTb ? "truck/bus handoff" : "truck/bus — details complete", { salesInquiry: "Other", inspectionBooked: false, milestone: !inTb ? "FOLLOW UP" : undefined });
        return NextResponse.json({ status: "truck_bus" }, { status: 200 });
      }
    }

    // ── Hiyaza only (ownership certificate, no plates / insurance) → no booking ──
    // Collect name + UAE number, team contacts them.
    {
      const HIYAZA = /\b(hiyaza|hiyaaza|hyaza|hiyazah|hiazah|hiaza|heyaza|ownership certificate|possession certificate|no (license |number )?plates?|without (license |number )?plates?|plates? (removed|cancelled|surrendered))\b/i;
      const HZ_LINE = "For cars under Hiyaza only, our team will contact you directly.";
      const HZ_NAME_Q = "May I have your name?";
      const HZ_PHONE_Q = "Which UAE number is best to reach you on?";
      const hist = (conversation.messages ?? []) as ConversationMessage[];
      const inHz = hist.some(m => m.role === "assistant" && m.content.includes(HZ_LINE))
        || String((conversation as any).car_conditions ?? "").includes("HIYAZA:");
      if ((inHz || HIYAZA.test(messageText)) && currentStep < CLOSING_STEP) {
        const lastA = [...hist].reverse().find(m => m.role === "assistant")?.content ?? "";
        const upd: Record<string, unknown> = { ...vehicleDbFields(vehicleUpdates), last_msg_id: message.id, last_message_at: new Date().toISOString() };
        let name = conversation.name;
        if (inHz && lastA.includes(HZ_NAME_Q) && !name) {
          const n = extractNameFromMessage(messageText);
          if (n) { upd.name = n; name = n; }
        }
        if (inHz && lastA.includes(HZ_PHONE_Q)) {
          const pm = messageText.match(/(?:\+?971|00971|0)?\s*5\d[\s-]?\d{3}[\s-]?\d{4}/);
          if (pm) {
            const raw = pm[0].replace(/\D/g, "");
            const alt = raw.startsWith("971") ? raw : `971${raw.replace(/^0/, "")}`;
            if (alt !== phone) upd.alternative_phone = alt;
          }
        }
        if (!inHz) {
          const ex = String((conversation as any).car_conditions ?? "");
          const note = "HIYAZA: car under ownership certificate only (no plates/insurance) — no appointment";
          if (!ex.includes("HIYAZA:")) upd.car_conditions = ex ? `${ex} | ${note}` : note;
        }
        const asked = (q: string) => hist.some(m => m.role === "assistant" && m.content.includes(q));
        const HZ_CAR_Q = "Could you share the make, model, year and mileage of the car?";
        const cz = { ...conversation, ...vehicleDbFields(vehicleUpdates) } as any;
        const carMissing = !cz.make || !cz.model || !cz.year || !cz.mileage;
        const nextQ = carMissing && !asked(HZ_CAR_Q) ? HZ_CAR_Q : !name && !asked(HZ_NAME_Q) ? HZ_NAME_Q : !isUAE && !asked(HZ_PHONE_Q) ? HZ_PHONE_Q : null;
        const reply = !inHz
          ? `Thanks for letting me know. ${HZ_LINE} ${nextQ ?? ""}`.trim()
          : nextQ ?? `Thanks! Our team will contact you ${teamWhen()}. Have a nice day!`;
        if (!nextQ && inHz) upd.step = CLOSING_STEP;
        await sendWhatsAppMessage(phone, reply);
        await updateConversation(phone, upd as any).catch(e => console.error("hiyaza save error:", e));
        await appendHistory(phone, hist, messageText, reply);
        if (!inHz || !nextQ) await pushLead(phone, !inHz ? "hiyaza handoff" : "hiyaza — details complete", { salesInquiry: "Other", inspectionBooked: false, milestone: !inHz ? "FOLLOW UP" : undefined });
        return NextResponse.json({ status: "hiyaza" }, { status: 200 });
      }
    }

    // ── Repeated price request or booking hesitation → offer a clear choice ──
    // Kaya: "How about I forward your details to our team…?" → yes → double-check car + number → hand over.
    {
      const OFFER_FWD = BOOKING_OR_TEAM_CHOICE;
      const LEGACY_OFFER_FWD = "Would you like to continue with the booking, or shall I forward your details to our team so you can discuss it with them in person?";
      const CONFIRM_MARK = "Just to double-check";
      const hist = (conversation.messages ?? []) as ConversationMessage[];
      const lastA = [...hist].reverse().find(m => m.role === "assistant")?.content ?? "";
      const YES = /^\s*(yes|yeah|yep|ya|yah|ok|okay|sure|please|pls|fine|go ahead|correct|right|alright|sounds good|good|perfect|👍|of course|why not)\b/i;
      const NO = /^\s*(no|nope|nah|not now|no thanks|no need|neither|none|not interested|don'?t want either|don'?t)\b/i;
      const DEFER_ANY = (t: string) => DEFER_PATTERN.test(t) || /\b(i'?ll|i will|will)\s+\w{2,4}\s+(you|u)\s+(know|update)\b|\b(let|tell)\s+(you|u)\s+(know|later)\b/i.test(t);
      const fin = async (reply: string, upd: Record<string, unknown> = {}) => {
        await sendWhatsAppMessage(phone, reply);
        await updateConversation(phone, { ...upd, last_msg_id: message.id, last_message_at: new Date().toISOString() } as any).catch(() => {});
        await appendHistory(phone, hist, messageText, reply);
      };
      const c = conversation as any;
      const carLine = [[c.make, c.model, c.year].filter(Boolean).join(" "), c.mileage ? `${Number(String(c.mileage).replace(/\D/g, "")).toLocaleString("en-US")} km` : "", c.specs && c.specs !== "Unknown" ? c.specs : ""].filter(Boolean).join(", ");

      if (lastA.includes(CONFIRM_MARK) && currentStep < CLOSING_STEP) {
        // Answer to the double-check → hand over to the team
        const notes: string[] = [String(c.car_conditions ?? "")].filter(Boolean);
        const upd: Record<string, unknown> = { step: CLOSING_STEP };
        const pm = messageText.match(/(?:\+|\b00)\d[\d\s-]{7,16}\d|(?:\+?971|\b0)\s*5\d[\s-]?\d{3}[\s-]?\d{4}\b|\b5\d{8}\b/);
        if (pm) { let alt = pm[0].replace(/\D/g, "").replace(/^00/, ""); if (/^05/.test(alt)) alt = "971" + alt.slice(1); else if (/^5\d{8}$/.test(alt)) alt = "971" + alt; if (alt !== phone) upd.alternative_phone = alt; }
        if (!YES.test(messageText) && !pm) notes.push(`Customer correction: ${messageText.slice(0, 120)}`);
        const priceChoice = hist.some(m => m.role === "user" && PRICE_OFFER_PATTERN.test(m.content));
        notes.push(priceChoice ? "Forwarded to the team after repeated price requests" : "Forwarded to the team after booking hesitation");
        if (!notes.join(" | ").includes("Asked to speak to the team")) notes.push("Asked to speak to the team");
        upd.car_conditions = notes.join(" | ");
        await fin(`Thanks! I've passed everything on to our team. They'll be in touch ${teamWhen()}. Have a nice day!`, upd);
        await pushLead(phone, "forwarded to team", { salesInquiry: priceChoice ? "Price Offer Inquiry" : "Other", inspectionBooked: false, milestone: "FOLLOW UP" });
        return NextResponse.json({ status: "forwarded_to_team" }, { status: 200 });
      }

      if ((lastA.includes(OFFER_FWD) || lastA.includes(LEGACY_OFFER_FWD)) && currentStep < CLOSING_STEP) {
        const WANT_BOOK = /\b(continue|book|booking|first|1st|option 1|appointment|inspection|come in|visit)\b/i;
        const WANT_TEAM = /\b(forward|team|second|2nd|option 2|call|discuss|person|talk|speak)\b/i;
        const closeAsNotReady = async () => {
          const reply = "No problem. Whenever you're ready to sell your car, you're always welcome at Mister Wheelz. Here are our location and opening hours. Have a nice day!";
          const notes = [String(c.car_conditions ?? "").split(" | ").filter((n: string) => !n.startsWith("NOT READY YET:")).join(" | "), "NOT READY YET: Declined booking and personal call"].filter(Boolean).join(" | ");
          await fin(reply, { step: CLOSING_STEP, appointment_date: null, appointment_time: null, car_conditions: notes });
          await sendWhatsAppMessage(phone, LOCATION_TEXT);
          await pushLead(phone, "not ready yet", { inspectionBooked: false, topNote: "NOT READY YET" });
          await moveLeadToCallBack(phone);
          return NextResponse.json({ status: "booking_and_callback_declined" }, { status: 200 });
        };
        // An explicit rejection of both options takes precedence over words like "booking" or "call".
        const bothNegative = /^(?:\s*(?:neither|none|not interested(?: in either)?|no to both|(?:i\s+)?don'?t want either)\b|\s*no\b.{0,60}\b(?:book|booking)\b.{0,30}\b(?:call|callback)\b)/i.test(messageText)
          && !/\b(?:yes to|please|i want|i'd like)\b.{0,20}\b(?:team|call|callback|book|booking)\b/i.test(messageText);
        if (bothNegative) return closeAsNotReady();
        const rejectsVisit = /\b(?:too busy|no time|cannot|can'?t|won'?t|not able|without a number|without a price)\b/i.test(messageText);
        if (WANT_BOOK.test(messageText) && !WANT_TEAM.test(messageText) && !rejectsVisit) {
          // Continue from the day the customer already mentioned (never Sunday); otherwise ask for the day
          const userTexts = hist.filter(m => m.role === "user").map(m => m.content);
          let iso: string | null = null;
          for (const t of [...userTexts].reverse()) {
            if (/\bweek\s*-?\s*end\b/i.test(t)) { iso = toIsoDate("saturday"); break; }
            const dm = t.match(/\b(\d{1,2})(st|nd|rd|th)?\s*(of\s*)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i);
            const wd = t.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|tomorrow)\b/i);
            const c = dm ? toIsoDate(`${dm[1]} ${dm[4]}`) : wd ? toIsoDate(wd[1]) : null;
            if (c) { iso = rollSameWeekday(c, t, "", userTexts); break; }
          }
          const todayIso = new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
          if (iso && (iso < todayIso || new Date(iso + "T12:00:00Z").getUTCDay() === 0)) iso = null;
          if (iso) {
            const d = new Date(iso + "T12:00:00Z");
            const t = await pickDefaultTime(iso, phone);
            const h = +t.slice(0, 2);
            const x = d.getUTCDate(), sfx = x % 10 === 1 && x !== 11 ? "st" : x % 10 === 2 && x !== 12 ? "nd" : x % 10 === 3 && x !== 13 ? "rd" : "th";
            const when = `${["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][d.getUTCDay()]} ${x}${sfx} of ${["January","February","March","April","May","June","July","August","September","October","November","December"][d.getUTCMonth()]}`;
            await fin(`Great! Shall I book you for ${when} at ${h % 12 || 12}:${t.slice(3)} ${h < 12 ? "AM" : "PM"}? Our team will confirm the exact time with you on the morning of the booking.`);
          } else {
            await fin("Great! Which day would suit you best? We're open Monday to Saturday, and our team will confirm the exact time with you on the morning of the booking.");
          }
          return NextResponse.json({ status: "forward_declined_book" }, { status: 200 });
        }
        if (WANT_TEAM.test(messageText) || YES.test(messageText)) {
          const numQ = isUAE ? "and can our team reach you on this number?" : "and which number can our team reach you on?";
          await fin(`Great! ${CONFIRM_MARK}: ${carLine || "your car"}. Is that correct, ${numQ}`);
          return NextResponse.json({ status: "forward_confirm" }, { status: 200 });
        }
        if (NO.test(messageText)) {
          return closeAsNotReady();
        }
        if (rejectsVisit) {
          await fin(NOT_READY_CHOICE);
          return NextResponse.json({ status: "booking_declined_call_offered" }, { status: 200 });
        }
      }

      const offeredBefore = hist.some(m => m.role === "assistant" && (m.content.includes(OFFER_FWD) || m.content.includes(LEGACY_OFFER_FWD)));
      const priorDefers = hist.filter(m => m.role === "user" && DEFER_ANY(m.content)).length;
      const DIFFICULT = /\b(difficult|hard|not possible|impossible|can'?t (make it|come|manage)|cannot (come|make it)|no time|too busy|very busy|not easy|(i )?don'?t know|not sure|no idea|confused)\b/i;
      const priorPriceRequests = hist.filter(m => m.role === "user" && PRICE_OFFER_PATTERN.test(m.content)).length;
      const repeatedPriceRequest = priorPriceRequests >= 3 && PRICE_OFFER_PATTERN.test(messageText);
      const priceRefusal = priorPriceRequests > 0 && /\b(no\s*,?\s*thanks?|not interested|maybe later|i'?ll pass|don'?t want (to|it)|forget it|not for me|never mind|nevermind)\b/i.test(messageText);
      const consignmentDeclined = priorPriceRequests > 0 && hist.some(m => m.role === "assistant" && /consignment/i.test(m.content))
        && /\b(cash only|only cash|just cash|not consignment|no consignment|don'?t want consignment)\b/i.test(messageText);
      const priceFrustration = priorPriceRequests > 0 && /\b(just tell me|answer my question|i already told you|waste of time|ridiculous|frustrat\w*|stop asking|too many questions)\b/i.test(messageText);
      const askedForTeam = /\b(call me|call back|callback|speak to|speak with|talk to|talk with|contact me|human|real person|your team|purchasing team)\b/i.test(messageText);
      // "Not sure" here means unsure about cash versus consignment, not refusal to visit.
      const decidingSellingOption = lastA.includes("Is a quick transfer with cash payment more important")
        && isSellingOptionAnswer(messageText);
      if (!offeredBefore && !hasBooking && currentStep >= 5 && currentStep < CLOSING_STEP
          && !askedForTeam && !visitWindow && !decidingSellingOption && ((DEFER_ANY(messageText) && priorDefers >= 1) || DIFFICULT.test(messageText)
            || repeatedPriceRequest || priceRefusal || consignmentDeclined || priceFrustration)) {
        await fin(`I understand. ${OFFER_FWD}`);
        return NextResponse.json({ status: "forward_offer" }, { status: 200 });
      }
    }

    // ── Customer asks for a real person → push now, then collect details ─────
    // Mode is stateless: active once Kaya has sent the handoff line (HUMAN_LINE) in this chat.
    {
      const NAMED_PERSON = /\b(speak|talk|chat)\s+(to|with)\s+(mr\.?\s+|mrs\.?\s+|ms\.?\s+)?(?!(you|u|me|him|her|them|us|someone|somebody|anyone|people|the|a|an|your|my|our|his|their|this|that|it|later|again|soon|family|wife|husband|brother|sister|friend|father|mother|dad|mom|bank)\b)[a-z]{3,}\b/i;
      const HUMAN_ASK  = /\b((speak|talk|chat)\s+(to|with)\s+(a\s+|your\s+|the\s+|one of your\s+)?(real\s+|actual\s+)?(someone|somebody|person|human|agent|manager|staff|team|people|guys)|(want|need|prefer)\s+(a\s+)?(real|actual)\s+person|human agent|call me(?=\s*(back|later|please|pls|now|asap|tomorrow|today|on|at|when|$|[.!?])))\b|\b(ask|tell|have|get)\s+(any ?one|some ?one|somebody|anybody|your team|the team)\s+(to\s+)?(contact|call|ring|reach)\s+me\b|\b(any ?one|some ?one|somebody|anybody)\s+(can|could|should|to|please)?\s*(contact|call|ring|reach)\s+me\b|\b(speak|talk|chat)\s+(to|with)\s+(a\s+)?(human|real|live)\b|\b(human|customer service|sales)\s+(representative|rep|agent|person)\b/i;
      // Marc (13 Oct): any sign they want a real person / not a bot
      const HUMAN_ASK2 = /\b(real|actual|live|proper|normal)\s+(human|person|people|agent|guy|man|woman|staff|someone|somebody)\b|\b(not|no|don'?t want( to talk to)?( a)?|stop( the)?|without( a| the)?)\s+(a\s+|the\s+|an\s+|this\s+)?(bot|robot|ai|a\.i\.?|chat ?bot|machine|automated|auto ?reply|computer)\b|\b(are|r)\s+(you|u)\s+(a\s+|an\s+)?(bot|robot|ai|a\.i\.?|chat ?bot|machine|real|human|person|automated)\b|\b(is this|am i (talking|chatting|speaking) (to|with))\s+(a\s+|an\s+)?(bot|robot|ai|machine|real person|human)\b|\b(talk|speak|chat)\s+(to|with)\s+(a\s+|an\s+|your\s+|the\s+)?(human|person|agent|representative|rep|staff|employee|manager|supervisor|salesman|sales ?person|operator|someone real)\b|\b(connect|transfer|forward|pass)\s+me\s+(to|with)\b|\b(need|want|prefer)\s+(to\s+)?(talk|speak|chat)\s+(to|with)\s+(some ?one|somebody|a person|a human|your team)\b|\b(give|send|share)\s+(me\s+)?(a|the|your)\s+(phone|contact|mobile)\s+(number|no)\s+(of|for)\s+(your|a|the)\s+(team|agent|manager|staff|person)\b|\bplease\s+call\b|\bcan\s+(you|u|someone|somebody|anyone)\s+call\b/i;
      const HUMAN_HINT = /\b(human|person|people|bot|robot|ai|a\.i|machine|automated|agent|representative|rep|staff|manager|someone|somebody|anyone|anybody|team|call|ring|phone|real)\b/i;
      const HUMAN_LINE = "I'll have someone from our team contact you";   // + timing, see below
      const hist = (conversation.messages ?? []) as ConversationMessage[];
      const inHumanMode = hist.some(m => m.role === "assistant" && m.content.includes(HUMAN_LINE))
        || String((conversation as any).car_conditions ?? "").includes("Asked to speak to the team");
      // Obvious frustration → stop asking questions, hand over to the team
      const PRICE_WORDS = /\b(price|number|offer|quote|how much|worth|value|amount|pay)\b/i;
      const letters = messageText.replace(/[^A-Za-z]/g, "");
      // All caps alone is not frustration when the message is about the car (many customers type in caps)
      const carInfoInMsg = !!(vehicleUpdates.make || vehicleUpdates.model || vehicleUpdates.year || vehicleUpdates.mileage)
        || /\b(19|20)\d{2}\b|\b\d+\s*k?\s*(km|kms)\b/i.test(messageText);
      // Some customers type everything in capitals — only a sudden switch to caps with "!" counts as shouting
      const capsRatio = (t: string) => { const l = t.replace(/[^A-Za-z]/g, ""); return l.length >= 8 ? l.replace(/[^A-Z]/g, "").length / l.length : 0; };
      const wroteNormallyBefore = hist.some(m => m.role === "user" && m.content.replace(/[^A-Za-z]/g, "").length >= 8 && capsRatio(m.content) < 0.5);
      const shouting = !carInfoInMsg && wroteNormallyBefore && capsRatio(messageText) >= 0.7 && /!/.test(messageText);
      const FRUSTRATION_PHRASES = /(!!!+|\bsimple question\b|\banswer (me|my question|the question)\b|\b(just|simply) (tell|give) me\b|\bi (already )?(told|said) (you|that|it)\b|\bare you (even )?(listening|reading)\b|\bwaste of (my )?time\b|\bridiculous\b|\bannoying\b|\bfrustrat\w*|\bwtf\b|\bseriously\b|\bstop asking\b|\btoo many questions\b)/i;
      const priorPriceAsks = hist.filter(m => m.role === "user" && PRICE_WORDS.test(m.content)).length;
      const lastA0 = [...hist].reverse().find(m => m.role === "assistant")?.content ?? "";
      const frustrated = frustratedByInsult || shouting || FRUSTRATION_PHRASES.test(messageText);
      const firstAsk = !inHumanMode && currentStep >= 1 && currentStep < CLOSING_STEP
        && (HUMAN_ASK.test(messageText) || HUMAN_ASK2.test(messageText) || NAMED_PERSON.test(messageText) || frustrated
          // wording the patterns don't know → quick AI check, only when the message hints at it
          || (HUMAN_HINT.test(messageText) && messageText.length < 200 && await wantsHuman(messageText))
          // reply to the 5-minute nudge ("…or if you need a call back from our team") asking for a call
          || (lastA0.includes("need a call back from our team") && /\b(call|callback|ring|phone me)\b/i.test(messageText))
          // after the one home-visit explanation: any objection → understanding + call back (Marc)
          || (hist.some(m => m.role === "assistant" && /inspections at our branch|All our inspections are done at/i.test(m.content))
              && !(conversation.appointment_date && conversation.appointment_time)
              && /\bhome\b|\b(come|visit)\s+(to\s+)?(my|me)\b|\bmy (place|house|villa|office)\b|\bbusy\b|\bno time\b|\bcan'?t (come|make it|bring)\b|\bnot bringing\b|\btoo far\b|\bnot possible\b|\bprice\b|\brange\b|\bhow much\b|\boffer\b|\bestimate\b|\bnumber\b/i.test(messageText)));
      if ((firstAsk || inHumanMode) && currentStep < CLOSING_STEP && !(carSpecs === "Non-GCC")) {
        const vDb = vehicleDbFields(vehicleUpdates);
        const updates: Record<string, unknown> = { ...vDb, last_msg_id: message.id };
        const c = { ...conversation, ...vDb } as any;
        let conditions: string = c.car_conditions ?? "";
        const lastA = [...hist].reverse().find(m => m.role === "assistant")?.content ?? "";
        if (!c.name) { // name question answered inside a frustrated message ("Omar here. Just give me a range")
          const n = nameFromHistory([...hist, { role: "user", content: messageText }]);
          if (n) { c.name = n; updates.name = n; }
        }

        // Save answers to the questions asked last time
        if (!firstAsk && /what would you like to discuss/i.test(lastA)) {
          conditions = conditions ? `${conditions} | Wants to discuss: ${messageText}` : `Wants to discuss: ${messageText}`;
          updates.car_conditions = conditions;
        }
        if (!firstAsk && /best (number )?to reach you/i.test(lastA)) {
          const pm = messageText.match(/(?:\+?971|0)?\s*5\d[\s-]?\d{3}[\s-]?\d{4}/);
          const intl = !pm ? messageText.match(/\+?\d[\d\s-]{7,16}\d/) : null;   // foreign numbers too
          if (pm) {
            const raw = pm[0].replace(/\D/g, "");
            const alt = raw.startsWith("971") ? raw : `971${raw.replace(/^0/, "")}`;
            if (alt !== phone) updates.alternative_phone = alt;
          } else if (intl) {
            const alt = intl[0].replace(/\D/g, "").replace(/^00/, "");
            if (alt !== phone) updates.alternative_phone = alt;
          }
        }

        // Ask each car detail at most once here — never loop on the same question
        const askedBefore = (k: string) => hist.some(m => m.role === "assistant"
          && (k === "make" ? /share the make, model and year/i.test(m.content) : new RegExp(`share the ${k} of the car`, "i").test(m.content)));
        if (!firstAsk && /share the (make|model|year)/i.test(lastA)) {
          const note = `Car (customer's words): ${messageText.slice(0, 120)}`;
          if (!conditions.includes(note)) { conditions = conditions ? `${conditions} | ${note}` : note; updates.car_conditions = conditions; }
        }
        const missingCar = (["make", "model", "year", "mileage"] as const).find(k => (!c[k] || c[k] === "Unknown") && !askedBefore(k) && !askedBefore("make"));
        const topicDone  = /Wants to discuss:/.test(conditions);
        const phoneAsked = hist.some(m => m.role === "assistant" && /best (number )?to reach you/i.test(m.content));

        let nextQ: string | null = null;
        // Marc (13 Oct): asked for a person → always ask the number first (UAE numbers too)
        if (!phoneAsked) nextQ = "Which number is best to reach you on?";
        else if (missingCar) nextQ = missingCar === "make" ? "In the meantime, could you share the make, model and year of your car?" : `Could you share the ${missingCar} of the car?`;
        else if (!c.name && !hist.some(m => m.role === "assistant" && /may i (have|know) your name/i.test(m.content))) nextQ = "May I have your name?";
        void topicDone;

        const parts: string[] = [];
        if (firstAsk && frustrated) {
          parts.push(PRICE_WORDS.test(messageText) || priorPriceAsks > 0
            ? `Ok, I understand. ${HUMAN_LINE} so you can discuss it with them directly.`
            : `I understand. ${HUMAN_LINE} ${teamWhen()}.`);
          const topic = PRICE_WORDS.test(messageText) || priorPriceAsks > 0 ? "price — customer was frustrated (pushing for a price)" : "customer was frustrated";
          if (!conditions.includes("Wants to discuss:")) conditions = conditions ? `${conditions} | Wants to discuss: ${topic}` : `Wants to discuss: ${topic}`;
          if (!conditions.includes("Asked to speak to the team")) conditions = `${conditions} | Asked to speak to the team`;
          updates.car_conditions = conditions;
        } else if (firstAsk) {
          parts.push(`${HUMAN_LINE} ${teamWhen()}.`);
          {
            const dayMsg = [...hist].reverse().find(m => m.role === "user" && /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|\d{1,2}(st|nd|rd|th)\b|\d{1,2}\s*(oct|nov|dec|jan))/i.test(m.content))?.content;
            if (dayMsg && !conditions.includes("Preferred day:")) conditions = conditions ? `${conditions} | Preferred day: "${dayMsg.slice(0, 60)}"` : `Preferred day: "${dayMsg.slice(0, 60)}"`;
          }
          if (!conditions.includes("Asked to speak to the team")) {
            conditions = conditions ? `${conditions} | Asked to speak to the team` : "Asked to speak to the team";
            updates.car_conditions = conditions;
          }
        }
        if (!nextQ && !firstAsk && /\?/.test(messageText)) {
          // Handed over, but the customer still asks something (documents, is it free…) → answer it
          const ans = await getKayaReply(CLOSING_STEP, hist, messageText, { name: c.name, make: c.make, model: c.model, year: c.year, team_when: teamWhen() } as any);
          parts.push(ans);
        } else {
          if (nextQ) parts.push(nextQ);
          else if (firstAsk) parts[parts.length - 1] = `${parts[parts.length - 1]} Have a nice day!`;   // one message, not two
          else parts.push(`Thanks, I've passed everything on. Our team will be in touch ${teamWhen()}. Have a nice day${firstName((conversation as any).name)}!`);
        }

        for (const part of parts) await sendWhatsAppMessage(phone, part);
        if (!nextQ) updates.step = CLOSING_STEP;
        await updateConversation(phone, updates as any).catch(e => console.error("human handoff save error:", e));
        await appendHistory(phone, hist, messageText, parts.join("\n\n"));
        // Push immediately on the request, and again once details are complete
        if (firstAsk || !nextQ) await pushLead(phone, firstAsk ? "asked for a person" : "person request — details complete", { salesInquiry: "Other", inspectionBooked: false, milestone: firstAsk ? "FOLLOW UP" : undefined });
        return NextResponse.json({ status: "human_handoff" }, { status: 200 });
      }
    }

    // Verified non-GCC (Mulkiya engine-number field NONE/NIL/blank): no booking.
    // Keep collecting the car, name and UAE contact number for the purchasing team.
    const verifiedNonGcc = String((conversation as any).car_conditions ?? "").includes("Non-GCC: Mulkiya engine number NONE/NIL/blank");
    if (verifiedNonGcc && currentStep < CLOSING_STEP) {
      const hist = (conversation.messages ?? []) as ConversationMessage[];
      const vDb = vehicleDbFields(vehicleUpdates);
      const c = { ...conversation, ...vDb, specs: "Non-GCC" } as any;
      const lastA = [...hist].reverse().find(m => m.role === "assistant")?.content ?? "";
      const firstTime = !hist.some(m => m.role === "assistant" && /team will get back to you about this car/i.test(m.content));
      if (!c.name && /may I have your name/i.test(lastA)) {
        const name = extractNameFromMessage(messageText);
        if (name) c.name = name;
      }
      const phoneMatch = messageText.match(/(?:\+?971|00971|0)?\s*5\d[\s-]?\d{3}[\s-]?\d{4}/);
      if (phoneMatch) {
        const raw = phoneMatch[0].replace(/\D/g, "");
        c.alternative_phone = raw.startsWith("971") ? raw : `971${raw.replace(/^0/, "")}`;
      }
      const missingCar = (["make", "model", "year", "mileage"] as const).filter(k => !c[k] || c[k] === "Unknown");
      const hasUaePhone = isUAE || !!c.alternative_phone;
      const nextQ = missingCar.length ? `Could you share the ${missingCar.join(", ")} of the car?`
        : !c.name ? "May I have your name?"
        : !hasUaePhone ? "Which UAE mobile number is best for our team to reach you on?"
        : null;
      const intro = firstTime ? "Thanks for checking. This indicates a non-GCC car, so I won't book an inspection. Our team will get back to you about this car." : "Thanks.";
      const reply = nextQ ? `${intro} ${nextQ}` : `${intro} Our team will contact you ${teamWhen()}.`;
      const updates: Record<string, unknown> = { ...vDb, specs: "Non-GCC", non_gcc_handoff: true,
        ...(c.name ? { name: c.name } : {}), ...(c.alternative_phone ? { alternative_phone: c.alternative_phone } : {}),
        last_msg_id: message.id, last_message_at: new Date().toISOString(), ...(nextQ ? {} : { step: CLOSING_STEP }) };
      await sendWhatsAppMessage(phone, reply);
      await updateConversation(phone, updates as any).catch(e => console.error("non-GCC save error:", e));
      await appendHistory(phone, hist, messageText, reply);
      if (firstTime || !nextQ) await pushLead(phone, firstTime ? "verified non-GCC" : "verified non-GCC details", {
        salesInquiry: "Other", inspectionBooked: false, milestone: firstTime ? "FOLLOW UP" : undefined,
      });
      return NextResponse.json({ status: "verified_non_gcc_handoff" }, { status: 200 });
    }

    if (Array.isArray(vehicleUpdates.typo_check) && vehicleUpdates.typo_check.length > 0) {
      for (const tc of vehicleUpdates.typo_check) {
        if (tc.field === "model" && (!vehicleUpdates.model || vehicleUpdates.model === "Unknown")) {
          // An unsure guess ("Fiesta or Focus?") is never saved — keep what the customer wrote ("Figo")
          vehicleUpdates.model = /\?|\bor\b|unverified/i.test(String(tc.suggestion)) ? String(tc.input) : tc.suggestion;
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
    const step3OldCar   = step3Complete && carYear > 0 && carYear < 2020;

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
    const PRICE_PUSH      = PRICE_OFFER_PATTERN;
    const HUMAN_REQUEST   = /\b(call me(?=\s*(back|later|please|pls|now|asap|tomorrow|today|on|at|when|$|[.!?]))|(speak|talk)\s+(to|with)\s+(a\s+)?(someone|somebody|person|human|agent|manager|staff|team)|real person|human agent)\b/i;
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
      // "open to consignment" / "either" / "maybe" is not a choice
      if (/\b(open to|either|both|maybe|depends|not sure|could be|whatever)\b/i.test(messageText)) sellMethod = "not_sure";
      else if (SELL_METHOD_CASH.test(messageText))        sellMethod = "cash";
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
      (pricePushCount >= 1 && BOOKING_REFUSAL.test(messageText)) ||
      (alreadyExplainedOptions && customerWantsCashOnly && BOOKING_REFUSAL.test(messageText));

    // If customer pushes on price a second time (and consignment not yet explained) → let Claude pivot to consignment
    // If customer gives up / not interested after consignment was explained → offer callback
    // Home service (Marc): explain ONCE that all inspections are at our branch; any objection after
    // that (home visit again, busy / can't come / too far, price, refusal) → understanding + call back
    const HOME_VISIT = /\bhome\s*(visit|inspection|service|check|pick\s*up|collection)|\b(come|visit)\s+(to\s+)?(my|me|our)\b|\bat my (house|home|place|location|villa|apartment|office)\b|\bpick\s*(it\s*)?up\b|\bdoorstep\b|\bcollect\s*(from|at)\b|\bmobile inspection\b/i;
    const homeExplained = history.some(m => m.role === "assistant" && /inspections at our branch|All our inspections are done at/i.test(m.content));
    const OBJECTION = /\b(busy|no time|don'?t have time|can'?t (come|make it|bring)|cannot (come|bring)|unable to (come|bring|drive)|too far|far away|not possible|difficult|working|at work|office hours)\b/i;
    const homeObjection = homeExplained && !(conversation.appointment_date && conversation.appointment_time)
      && (HOME_VISIT.test(messageText) || OBJECTION.test(messageText) || PRICE_PUSH.test(messageText) || BOOKING_REFUSAL.test(messageText));
    const priceAndHome = homeObjection;
    const callbackSignal = handoffSignal || priceAndHome;
    if (!action && currentStep >= 5 && currentStep < CLOSING_STEP && callbackSignal) {
      action = { type: "OFFER_CALLBACK" };
    }

    const estMake    = (vehicleUpdates.make  ?? conversation.make)  ?? "";
    const estModel   = (vehicleUpdates.model ?? conversation.model) ?? "";
    const estYear    = (vehicleUpdates.year  ?? conversation.year)  ?? "";
    const estMileage = vehicleUpdates.mileage ?? conversation.mileage;
    const estSpecs   = vehicleUpdates.specs   ?? conversation.specs;
    const valuation  = (estMake && estModel && estModel !== "Unknown" && estYear)
      ? estimateCarValue(estMake, estModel, String(Math.min(parseInt(estYear, 10) || 0, new Date().getFullYear()) || estYear), estMileage, estSpecs)
      : null;

    // At step 0 (greeting), never pass stale vehicle data — customer is just saying hi
    const conversationForFields = currentStep === 0
      ? { ...conversation, make: null, model: null, year: null, mileage: null, specs: null, car: null, loan: null, mortgage_amount: null, sell_timeline: null }
      : conversation;

    const knownFields = {
      ...conversationForFields,
      ...coreUpdates,
      ...vehicleUpdates,
      image_shared: mediaInBurst || isImageMessage || undefined,
      whatsapp_uae:     isUAE,
      sell_timeline:    sellTimeline,
      sell_urgent:      sellUrgent,
      dubai_hour:       getDubaiHour(),
      dubai_datetime:   getDubaiDateTime(),
      dubai_tomorrow:   getDubaiTomorrow(),
      booking_slot:     getBookingSlot(),
      team_when:        teamWhen(),
      rebooking:        isRebook && !hasBooking ? `Customer wants to book an inspection now (the chat was closed earlier without a booking). Confirm a valid date and time and send the confirmation. Ask for the name only if unknown; don't ask for the number again if it was already given.`
                      : isRebook ? `Customer is RESCHEDULING an existing booking (was: ${conversation.appointment_date ?? "?"} ${conversation.appointment_time ?? ""}). Confirm the new date/time and send the confirmation. Do NOT ask for name or number again.` : undefined,
      mortgage_amount:  mortgageAmount ?? conversation.mortgage_amount,
      skip_mortgage:    hasAllVehicleFields && carYear > 0 && (currentYear - carYear) >= 10,
      next_action:      action ? describeAction(action) : undefined,
      appointment_date: apptDate || conversation.appointment_date || undefined,
      appointment_time: apptTime || conversation.appointment_time || undefined,
    };

    console.log(`[kaya] step=${currentStep} action=${action?.type ?? "none"}`);

    // Customer asked something during a hardcoded step → let Kaya answer it first, then ask the step question
    const ASKED_QUESTION = /\?|\b(do|does|can|could|will|would|are|is)\s+(you|u|it|they|there|this)\b|\b(how|what|whats|what's|where|why|which|when)\b|\b(price|number|offer|quote|how much|worth)\b/i;
    const customerAsked = !!action && action.type !== "OFFER_CALLBACK" && currentStep >= 1 && ASKED_QUESTION.test(messageText);
    if (customerAsked) (knownFields as any).answer_question_first = true;
    let reply = action && !customerAsked
      ? buildDirectResponse(action, (knownFields.name ?? conversation.name) as string | null, knownFields)
      : await getKayaReply(jumpToBooking ? FINAL_STEP : currentStep, history, messageText, knownFields);
    if (reply === SAFE_PRICE_REPLY) {
      const follow = action && action.type !== "OFFER_CALLBACK"
        ? buildDirectResponse(action, (knownFields.name ?? conversation.name) as string | null, knownFields)
        : getBookingSlot().match(/Ask exactly: "([^"]+)"/)?.[1] ?? "";
      if (follow) reply = `${reply} ${follow}`;
    }
    // Price asked while we're settling the day/time (Marc): fixed reassurance, then a choice of DAY —
    // never pressure for a time today. 3rd ask goes to the team (handled above).
    if (currentStep >= 5 && currentStep < CLOSING_STEP && !action && !apptFromMsg && PRICE_PUSH.test(messageText) && pricePushCount <= 1
        && !/\b(inspection|fee|fees|charge|charges|commission|cost)\b/i.test(messageText)) {
      const PRICE_1 = "Ok, I understand. We give you our final price right after a quick inspection of the car. When we agree, we'll buy the car cash immediately.";
      const PRICE_2 = "I understand. Every car is different, so we can only give an accurate price once we've seen it. The inspection is free, takes 10–15 minutes, and there's no obligation to sell.";
      const saidUrgent = [...history.filter(m => m.role === "user").map(m => m.content), messageText]
        .some(t => /\b(today|now|right now|asap|a\.s\.a\.p|immediately|urgent(ly)?|tomorrow|tmrw)\b/i.test(t));
      const pend = pendingBookingQ(lastAssistantMsg);
      const dayQ = pend ?? (pricePushCount === 0
        ? (saidUrgent ? (getBookingSlot().match(/Ask exactly: "([^"]+)"/)?.[1] ?? "Which day works for you?") : "Which day this week works for you?")
        : "Which day would be good for you?");
      reply = `${pricePushCount === 0 ? PRICE_1 : PRICE_2}\n[SPLIT]\n${dayQ}`;
    }
    if (negatedDay && currentStep >= 5 && currentStep < CLOSING_STEP && !appointmentConfirmedEarlyGuard(apptDate, apptTime)) {
      reply = "No problem. Which day works better for you?";
    }
    // "Do you buy for export / for yourselves / to resell?" (Marc, 13 Oct)
    {
      const PURPOSE = /\b(export\w*|for (your ?self|yourselves|yourself|own use|personal use)|re-?sell\w*|sell (it )?(again|to (other|others|another|dealers?|people))|trade|dealers?|auction)\b/i;
      if (PURPOSE.test(messageText) && /\?|\b(do|are|is|will|what)\b.{0,30}\b(you|u)\b/i.test(messageText) && !/\b(i|we)\s+(want|need|plan|am going)\s+to\s+export\b/i.test(messageText)) {
        const kw = /export/i.test(messageText) ? "export" : /resell|re-sell|sell (it )?again|sell to/i.test(messageText) ? "reselling" : /yourself|yourselves|own use|personal/i.test(messageText) ? "using cars ourselves" : "export";
        const ans = `We buy cars for different purposes, and ${kw} is one of them. This way we make sure we always get the highest price for your car.`;
        const pend = pendingBookingQ(lastAssistantMsg) ?? (reply.match(/[^.!?\n]*\?\s*$/)?.[0]?.trim() ?? "");
        reply = pend && currentStep < CLOSING_STEP ? `${ans}\n[SPLIT]\n${pend}` : ans;
      }
    }
    if (askOrigin) reply = "No problem. GCC specs means the car was made for the Gulf market. Did you buy the car here in the UAE, or was it imported from another country?";
    // Sunday (closed) → mention Saturday and Friday, never book a Sunday (Marc)
    if (/\bsun(day)?\b/i.test(messageText) && currentStep >= 5 && currentStep < CLOSING_STEP && !visitWindow && action?.type !== "OFFER_CALLBACK") {
      const dIsoS = String(apptDate || "");
      const isSun = !dIsoS || (/^\d{4}-\d{2}-\d{2}$/.test(dIsoS) && new Date(dIsoS + "T12:00:00Z").getUTCDay() === 0);
      if (isSun) {
        reply = sundayText();
        apptDate = ""; apptTime = ""; apptFromMsg = false;
        await updateConversation(phone, { appointment_date: null, appointment_time: null } as any).catch(() => {});
      }
    }
    // First home-visit question → one explanation, then carry on with the next question
    {
      const HOME_ASK = /\bhome\s*(visit|inspection|service|check|pick\s*up|collection)|\b(come|visit)\s+(to\s+)?(my|me|our)\s+(house|home|place|location|villa|apartment|office)\b|\bat my (house|home|place|location|villa|apartment|office)\b|\bpick\s*(it\s*)?up\b|\bdoorstep\b|\bmobile inspection\b/i;
      const explained = history.some(m => m.role === "assistant" && /inspections at our branch|All our inspections are done at/i.test(m.content));
      if (HOME_ASK.test(messageText) && !explained && currentStep >= 1 && currentStep < CLOSING_STEP && action?.type !== "OFFER_CALLBACK") {
        const HOME_LINE = "We do all our inspections at our branch. It only takes 10–15 minutes, and once we agree on the price we pay you cash on the spot.";
        const nextQ = action
          ? buildDirectResponse(action, (knownFields.name ?? conversation.name) as string | null, knownFields)
          : (currentStep >= 6 ? "Which day would be good for you?" : (reply.match(/[^.!?\n]*\?\s*$/)?.[0]?.trim() ?? ""));
        reply = nextQ ? `${HOME_LINE}\n[SPLIT]\n${nextQ}` : HOME_LINE;
      }
    }
    if (timing && !action && !visitWindow) {
      const addNote = async (n: string) => {
        const prev = String((conversation as any).car_conditions ?? "");
        if (!prev.includes(n)) await updateConversation(phone, { car_conditions: prev ? `${prev} | ${n}` : n } as any).catch(() => {});
      };
      const fmtT = (x: string) => { const h = +x.slice(0, 2); return `${h % 12 || 12}:${x.slice(3)} ${h < 12 ? "AM" : "PM"}`; };
      const fmtD = (d: string) => { const x = new Date(d + "T12:00:00Z"); const n = x.getUTCDate(); const sfx = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
        return `${["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][x.getUTCDay()]} ${n}${sfx} of ${["January","February","March","April","May","June","July","August","September","October","November","December"][x.getUTCMonth()]}`; };
      switch (timing.kind) {
        case "A": reply = "No problem, just let me know the day and time that suits you."; await addNote("Will confirm the day himself"); break;
        case "B": reply = timing.options && timing.options.length >= 2 ? `No problem. Would ${timing.options[0]} or ${timing.options[1]} work better for you?` : `No problem. Would ${timing.options?.[0] ?? "Saturday"} work for you?`; break;
        case "C": reply = `${LOCATION_TEXT}\n[SPLIT]\nWhich day would you like to come?`; await addNote("Asked for location"); break;
        case "D": reply = "You're welcome during our opening hours (Mon–Sat 10 AM–7 PM, Fri from 12 PM). If you tell me the day, I'll book a slot so we're ready for you. Which day suits you?"; await addNote("Walk-in, no fixed time"); break;
        case "E": reply = "No problem. When do you think you'll know?"; break;
        case "F": {
          const d = rollSameWeekday(toIsoDate(String(timing.day)), messageText, "",
            ((conversation.messages ?? []) as ConversationMessage[]).filter(m => m.role === "user").map(m => m.content));
          const dow = d ? new Date(d + "T12:00:00Z").getUTCDay() : -1;
          if (d && dow !== 0) {
            const t = await pickDefaultTime(d, phone);
            reply = `No problem. Shall I book you for ${fmtD(d)} at ${fmtT(t)}? You can always change it.`;
          } else reply = dow === 0 ? sundayText() : "No problem. Which day works best for you?";
          break;
        }
        case "G": reply = "No problem. When you're ready, just message us with a day that suits you."; break;
      }
    }
    // Putting it off ("ok i let u know tomorrow") is not a booking — never push, just leave the door open
    if (deferring && currentStep >= 5 && currentStep < CLOSING_STEP && !action && !(conversation.appointment_date && conversation.appointment_time)) {
      reply = "No problem, just let me know the day and time that suits you.";
    }
    if (mediaInBurst && currentStep <= 4 && /\?/.test(reply) && !/not able to open|unable to open|can'?t open photos/i.test(reply)) {
      reply = `Thanks! Unfortunately I'm not able to open photos or files, so I can only use the text you sent. ${reply}`;
    } else if (linkInMsg && currentStep <= 4 && /\?/.test(reply) && !/unable to open|not able to open/i.test(reply)) {
      reply = `${LINK_NOTE} ${reply}`;
    }

    // Hard check: a booking can only be confirmed for a valid slot (not past, not Sunday, within hours)
    {
      const dIso = String(apptDate || conversation.appointment_date || "");
      const t24 = toTime24(String(apptTime || conversation.appointment_time || ""));
      const looksConfirmed = (currentStep === FINAL_STEP || jumpToBooking) && !action &&
        /team will be in touch on whatsapp|\b(all set|you'?re set|booked|confirmed|see you|it'?s set|locked in)\b/i.test(reply);
      const rawT = String(apptTime || conversation.appointment_time || "");
      const unreadableTime = !!rawT && !t24 && /\b(now|right now|asap|soon)\b/i.test(rawT);
      if (looksConfirmed && (unreadableTime || /^\d{4}-\d{2}-\d{2}$/.test(dIso))) {
        const nowD = new Date(Date.now() + 4 * 3600e3);
        const today = nowD.toISOString().slice(0, 10);
        const dow = new Date(dIso + "T12:00:00Z").getUTCDay();
        const mins = t24 ? +t24.slice(0, 2) * 60 + +t24.slice(3) : null;
        const openM = dow === 5 ? 12 * 60 : 10 * 60;
        const invalid = unreadableTime || dIso < today || dow === 0 ||
          (mins != null && (mins < openM || mins > 18 * 60 + 30)) ||
          (mins != null && dIso === today && mins < nowD.getUTCHours() * 60 + nowD.getUTCMinutes());
        if (invalid) {
          const q = getBookingSlot().match(/Ask exactly: "([^"]+)"/)?.[1] ?? "What time can you come in tomorrow?";
          reply = `Sorry, that time doesn't work. We're open Mon–Thu and Sat 10:00–19:00, Fri 12:00–19:00, and closed on Sunday (last inspection slot 18:30). ${q}`;
          apptDate = ""; apptTime = "";
          await updateConversation(phone, { appointment_date: null, appointment_time: null } as any).catch(() => {});
          console.log(`[kaya] blocked invalid booking ${dIso} ${t24 ?? ""} for ${phone}`);
        }
      }
    }

    // Don't depend on one exact sentence — Kaya words it differently. Confirmed if a date AND
    // time were captured and the reply reads like a confirmation.
    const hasApptDateTime = !!(apptDate || conversation.appointment_date) && !!(apptTime || conversation.appointment_time);
    let appointmentConfirmedEarly = completingNamedBooking || (currentStep === FINAL_STEP || jumpToBooking) && !action && (
      /team will be in touch on whatsapp/i.test(reply) ||
      (hasApptDateTime && /\b(all set|you'?re set|booked|confirmed|see you|it'?s set|locked in|in touch)\b/i.test(reply))
    );

    // The customer gave a day/time in this message and we now have a valid date + time → that IS the
    // booking, even if Kaya's text didn't read like a confirmation (stress test: "anything after 2pm"
    // was saved as 2:30 PM but Kaya said the team would call).
    const clearIntent = !defaultedTime || messageText.trim().length <= 30 || /\b(come|coming|visit|bring|book|inspection|see you|available|free|works|ok(ay)?)\b/i.test(messageText);
    if (!appointmentConfirmedEarly && apptFromMsg && clearIntent && !deferring && !timing && currentStep >= 6 && !(currentStep === 6 && defaultedTime && !/\bwhat time\b/i.test(lastAssistantMsg)) && action?.type !== "OFFER_CALLBACK") {
      const dIso = toIsoDate(String(apptDate || conversation.appointment_date || "")) ?? "";
      const t24 = toTime24(String(apptTime || conversation.appointment_time || ""));
      if (/^\d{4}-\d{2}-\d{2}$/.test(dIso) && t24) {
        const nowD = new Date(Date.now() + 4 * 3600e3);
        const today = nowD.toISOString().slice(0, 10);
        const dow = new Date(dIso + "T12:00:00Z").getUTCDay();
        const mins = +t24.slice(0, 2) * 60 + +t24.slice(3);
        const openM = dow === 5 ? 12 * 60 : 10 * 60;
        const valid = dIso >= today && dow !== 0 && mins >= openM && mins <= 18 * 60 + 30
          && !(dIso === today && mins < nowD.getUTCHours() * 60 + nowD.getUTCMinutes());
        if (valid) {
          appointmentConfirmedEarly = true;
          console.log(`[kaya] booking registered from the customer's day/time: ${dIso} ${t24}`);
        }
      }
    }
    // Wants to sell now → no cash/consignment question, straight to the time (Marc)
    // Marc: no cash/consignment question — after "when do you want to sell?" always go to the appointment
    if (currentStep === 6 && !action && !timing && !visitWindow && !askOrigin && !asksBestWayToSell(messageText) && !lastAssistantMsg.includes("imported from another country") && !/\?/.test(messageText)) {
      const q = getBookingSlot().match(/Ask exactly: "([^"]+)"/)?.[1] ?? "What time can you come in tomorrow?";
      const nm = (coreUpdates as any).name ?? conversation.name;
      void nm;
      // Marc: "asap / as early as possible / soon / quick…" → "No problem!" then the closed line + time question
      const SOON = /\b(when the price is (right|good)|if the price is (right|good)|depends on the price|asap|a\.s\.a\.p|as (early|soon|fast|quick)(ly)? as possible|soon|early|quick(ly)?|fast|urgent(ly)?|now|immediately|today|tomorrow|tonorrow|tmrw|this week)\b/i;
      // "within 10 days" / "in a few days" / "next few days" → same answer as "this week" (Marc)
      const SOME_DAYS = /\b(with\s*in|in|next|coming)\s+(a\s+|the\s+)?(few|couple( of)?|\d+|two|three|four|five|ten)\s+(days|weeks)\b|\bfew days\b|\bend of (the )?week\b/i;
      const weekWord = messageText.match(/\b(this|next)\s+week\b/i)?.[1]?.toLowerCase() ?? (SOME_DAYS.test(messageText) ? "this" : undefined);
      const firstDay = /\b(today|this afternoon)\b/i.test(q) ? "today" : "tomorrow";
      // "I can come tomorrow" / "Thursday" → that day, not today's slots
      const dayM = messageText.match(/\b(tomorrow|tmrw|tmr|monday|tuesday|wednesday|thursday|friday|saturday)\b/i)?.[1]?.toLowerCase();
      const dayLabel = dayM ? (/^(tomorrow|tmrw|tmr)$/.test(dayM) ? "tomorrow" : `on ${dayM.charAt(0).toUpperCase() + dayM.slice(1)}`) : "";
      // "weekend" → Saturday (closed on Sunday); never offer today/tomorrow after that (Marc)
      const wantsWeekend = /\bweek\s*-?\s*end\b/i.test(messageText);
      let satIso = "";
      if (wantsWeekend) {
        const n = new Date(Date.now() + 4 * 3600e3);
        let add = (6 - n.getUTCDay() + 7) % 7; if (add === 0 && n.getUTCHours() >= 18) add = 7;
        satIso = new Date(n.getTime() + add * 86400e3).toISOString().slice(0, 10);
      }
      // Remember the chosen day, so "earliest possible" / "afternoon" next books that day
      const chosenDayIso = /\bsun(day)?\b/i.test(messageText) ? "" : (satIso || (dayM ? (toIsoDate(dayM) ?? "") : ""));
      if (/^\d{4}-\d{2}-\d{2}$/.test(chosenDayIso)) {
        apptDate = chosenDayIso;
        await updateConversation(phone, { appointment_date: chosenDayIso, appointment_time: null } as any).catch(() => {});
      }
      const saysSunday = /\bsun(day)?\b/i.test(messageText);
      if (saysSunday) await updateConversation(phone, { appointment_date: null, appointment_time: null } as any).catch(() => {});
      reply = saysSunday
        ? sundayText()
        : wantsWeekend
        ? "No problem, Saturday works. What time is best for you to bring the car on Saturday?"
        : dayLabel && !weekWord
        ? `No problem, what time is best for you to bring the car ${dayLabel}?`
        : weekWord
        // Marc: "this week / next week" → offer the first possible day, or a day of their choice
        ? `No problem, I can arrange an inspection for you ${firstDay} if you want, or else later ${weekWord === "next" ? "or next week" : "this week"}. Which day do you prefer?`
        : SOON.test(messageText) ? `No problem, ${q.charAt(0).toLowerCase() + q.slice(1)}`.replace(/\. What time is best/, ".\n\nWhat time is best") : q;
      if (lastAssistantMsg.includes("Is a quick transfer with cash payment more important")) {
        reply = `The purchaser can discuss quick cash and consignment with you immediately after the free inspection. ${reply}`;
      }
    }
    if (visitWindow && !action) reply = visitWindow.reply;
    // Safety net: Kaya wrote a booking confirmation but the flow didn't register one.
    // With a valid date + time → make it a real booking (Bigin, location); otherwise never send a fake one.
    if (!appointmentConfirmedEarly && /you'?re booked for|booking is (saved|confirmed)/i.test(reply)) {
      if (hasApptDateTime && toIsoDate(String(apptDate || conversation.appointment_date || "")) && toTime24(String(apptTime || conversation.appointment_time || ""))) {
        appointmentConfirmedEarly = true;
        console.warn("[kaya] confirmation written outside the booking step — registered as booking");
      } else {
        const q = getBookingSlot().match(/Ask exactly: "([^"]+)"/)?.[1] ?? "What time can you come in tomorrow?";
        console.warn("[kaya] blocked a booking confirmation without a valid date/time:", reply.slice(0, 200));
        reply = q;
      }
    }
    console.log(`[kaya] step=${currentStep} action=${action?.type ?? "-"} jump=${jumpToBooking} appt=${apptDate}|${apptTime} confirmed=${appointmentConfirmedEarly}`);
    // Never end on a dead end ("I understand.") while we're still booking — keep the conversation going
    if (currentStep >= 5 && currentStep < CLOSING_STEP && !hasBooking && !/\?/.test(reply)
        && !/\b(team will|be in touch|have a nice|see you|take care|passed (it|everything)|contact you|call you|you'?re booked)\b/i.test(reply)) {
      const askedSomething = /\?|^\s*(what|when|how|do|does|are|is|can|which|where)\b/i.test(messageText);
      const choice = BOOKING_OR_TEAM_CHOICE;
      const pend = pendingBookingQ(lastAssistantMsg);
      reply = `${reply.trim()}\n[SPLIT]\n${askedSomething && pend ? pend : choice}`;
    }
    // "Hello" in the middle of the chat → just repeat the open question (e.g. the "Shall I book you…" offer)
    if (currentStep >= 5 && currentStep < CLOSING_STEP && /^\s*(hello|hi|hey|hii+|helo|hlo|salam|assalam\w*|hello\?+|\?+)\W*$/i.test(messageText)) {
      const pend = pendingBookingQ(lastAssistantMsg);
      if (pend) reply = pend;
    }
    // Starting with "Nice," every time sounds robotic — once per chat is enough
    if (/^Nice[,!.]?\s+/i.test(reply) && ((conversation.messages ?? []) as ConversationMessage[]).some(m => m.role === "assistant" && /\bnice\b/i.test(m.content))) {
      reply = reply.replace(/^Nice[,!.]?\s+/i, "");
      reply = reply.charAt(0).toUpperCase() + reply.slice(1);
    }
    let replyParts = reply.split(/\[SPLIT\]/i).map(s => s.trim()).filter(Boolean);
    if (appointmentConfirmedEarly && !((coreUpdates as any).name ?? conversation.name)) {
      // The slot is saved, but it is not a confirmed booking or Bigin appointment yet.
      await updateConversation(phone, { step: FINAL_STEP, appointment_date: apptDate || conversation.appointment_date,
        appointment_time: apptTime || conversation.appointment_time, last_msg_id: message.id,
        last_message_at: new Date().toISOString() } as any);
      await sendWhatsAppMessage(phone, POST_NAME_Q);
      await appendHistory(phone, (conversation.messages ?? []) as ConversationMessage[], messageText, POST_NAME_Q);
      return NextResponse.json({ status: "booking_name_required" }, { status: 200 });
    }
    if (appointmentConfirmedEarly) {
      // Fixed confirmation format (car summary from Kaya stays as the first message, if she sent one)
      const nmForConf = (coreUpdates as any).name ?? conversation.name;
      const confRaw = formatBookingConfirmation(
        nmForConf,
        String(apptDate || conversation.appointment_date || ""),
        String(apptTime || conversation.appointment_time || ""),
      );
      // Goodbye only in the very last message: not here if we still ask the name / number after the booking
      const conf = confRaw && (!nmForConf || !isUAE) ? confRaw.replace(/\s*(Have a nice (day|evening)|See you (later|tomorrow))[^!]*!/, "") : confRaw;
      if (conf) {
        // Keep only the car-summary lines from Kaya's own text (her "booked you for 10:00" could contradict the slot)
        const summaryRaw = replyParts.find(p => /^(Make|Model|Year):/m.test(p));
        const authoritativeSpecs = vehicleUpdates.specs ?? conversation.specs;
        const summaryLines = summaryRaw?.split("\n").filter(l => /^(Make|Model|Year|Mileage|Specs|Loan):/i.test(l.trim()))
          .map(l => /^Specs:/i.test(l.trim()) && authoritativeSpecs ? `Specs: ${authoritativeSpecs}` : l) ?? [];
        if (authoritativeSpecs && summaryLines.length && !summaryLines.some(l => /^Specs:/i.test(l.trim())))
          summaryLines.push(`Specs: ${authoritativeSpecs}`);
        const summary = summaryLines.join("\n");
        // The customer asked something in the same message → keep Kaya's answer (without any times/booking talk)
        let answer = "";
        if (/\?/.test(messageText)) {
          answer = replyParts.filter(p => p !== summaryRaw).join(" ")
            .split(/(?<=[.!?])\s+/)
            .filter(sen => sen.trim() && !/\d{1,2}(:\d{2})?\s*(am|pm)\b|\bbook(ed|ing)?\b|\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow)\b|\bsee you\b|\?\s*$|^(make|model|year|mileage|specs):/i.test(sen))
            .join(" ").trim();
        }
        replyParts = [...(answer ? [answer] : []), ...(summary ? [summary] : []), conf];
        reply = replyParts.join("\n[SPLIT]\n");
      }
      const selectedSlot = toTime24(String(apptTime || conversation.appointment_time || ""));
      const customerStatedSelectedTime = [...history.filter(m => m.role === "user").map(m => m.content), messageText]
        .some(t => [...t.matchAll(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b\d{1,2}:\d{2}\b/gi)]
          .some(m => toTime24(m[0]) === selectedSlot));
      if (defaultedTime || (selectedSlot?.endsWith(":15") && !customerStatedSelectedTime)) {
        replyParts[replyParts.length - 1] += "\n\nI've booked this slot for you. Our call centre will confirm the exact timing with you on the morning of the booking.";
        reply = replyParts.join("\n[SPLIT]\n");
      }
      replyParts[replyParts.length - 1] += "\n\nHere below is our location.";
    }
    // Loan on the car → reassure first, then the next question as its own message (Marc)
    {
      const LOAN_LINE = "Okay no problem, we have a free loan settlement service so we can help you to settle the loan with your bank.";
      const saidLoanLine = history.some(m => m.role === "assistant" && m.content.includes("free loan settlement service"));
      if (currentStep === 5 && loanIsYes && action?.type === "SHOW_FULL_SUMMARY" && !saidLoanLine && replyParts.length === 1) {
        replyParts = [LOAN_LINE, replyParts[0].replace(/^(great|alright|got it|thanks|okay|ok|nice)[!.,]?\s*/i, "")];
        reply = replyParts.join("\n[SPLIT]\n");
      }
    }
    // Greeting follows the clock: "Good morning! I'm Kaya…"
    // …and right after they give their name: "Good morning Marc! What car would you like to sell?"
    if (currentStep === 1 && replyParts.length) replyParts[0] = replyParts[0].replace(/^(hi|hello|hey|nice to meet you)[,\s]+([A-Z][a-z]+)!/i, (_m, _h, nm) => `${timeGreeting()} ${nm}!`);
    // Marc's intro wording for the name question
    if (replyParts.length && /I'm Kaya from Mister Wheelz/i.test(replyParts[0])) replyParts[0] = replyParts[0].replace(/(?:Before we start,?\s*)?May I (?:have|know) your name(?: please)?\?/i, "Before we start may I know your name please?");
    if (replyParts.length && /I'm Kaya from Mister Wheelz/i.test(replyParts[0])) replyParts[0] = replyParts[0].replace(/^(hi|hello|hey)(\s+[A-Z][a-z]+)?!/i, (_m, _h, nmPart) => `${timeGreeting()}${nmPart ?? ""}!`);
    // Never repeat the closing line ("Our team will be in touch… Have a nice day!") a second time
    {
      const prevA = history.filter(m => m.role === "assistant").map(m => m.content).join("\n");
      const CLOSERS = [/\s*Our (purchase )?team will be in touch[^.!]*[.!]/gi, /\s*Have a nice (day|evening)[^!]*!/gi];
      replyParts = replyParts.map(p => {
        let out = p;
        for (const re of CLOSERS) { re.lastIndex = 0; if (re.test(prevA)) { re.lastIndex = 0; out = out.replace(re, ""); } }
        // "Take care, and have a nice day!" → "Take care!" (never leave a dangling ", and")
        out = out.replace(/[,\s]+(and|&)\s*$/i, "").trim();
        if (out && out !== p.trim() && !/[.!?)]$/.test(out)) out += "!";
        return out.trim() || p;
      });
    }
    {
      const lastSent = [...history].reverse().find(m => m.role === "assistant")?.content ?? "";
      const nz = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (lastSent && replyParts.length === 1 && nz(replyParts[0]) === nz(lastSent)) {
        // Never send the same question word for word (Marc) — check what they meant instead
        if (/\?\s*$/.test(lastSent)) {
          console.warn("[kaya] identical question to the previous one — rephrased");
          const q = lastSent.replace(/^(great|alright|got it|thanks|okay|ok|nice)[!.,]?\s*/i, "");
          replyParts = [/mileage/i.test(q)
            ? "Sorry, I didn't catch the mileage. Roughly how many km has the car done? For example 120,000 km."
            : `Sorry, I didn't quite catch that. ${q}`];
          if (history.some(m => m.role === "assistant" && m.content === replyParts[0])) replyParts = [];
        } else {
          console.warn("[kaya] identical reply to the previous one — not repeated");
          replyParts = [];
        }
      }
    }
    // No "Perfect, Razi - Monday … 3:00 PM" twice in a row
    {
      const lastSent = [...history].reverse().find(m => m.role === "assistant")?.content ?? "";
      if (replyParts.length && /^perfect\b/i.test(lastSent) && /^perfect\b/i.test(replyParts[0]) && !/you'?re booked for/i.test(replyParts[0])) {
        const nm = String((coreUpdates as any).name ?? conversation.name ?? "");
        const rest = replyParts[0].replace(/^perfect\b[^.?!]*[.?!]\s*/i, "").trim();
        void nm;
        replyParts[0] = rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : replyParts[0];
      }
    }
    // A bit of emotion (Marc): once per chat, react to a very low mileage or a special car
    {
      const said = currentStep >= 5 || ((conversation.messages ?? []) as ConversationMessage[]).some(m => m.role === "assistant" && /\bnice\b/i.test(m.content));
      const yr = parseInt(String(estYear), 10);
      const km = estMileage ? parseInt(String(estMileage).replace(/\D/g, ""), 10) : NaN;
      const age = yr ? Math.max(1, new Date().getFullYear() - yr) : 0;
      const LUX = /^(rolls|ferrari|lamborghini|bentley|mclaren|aston|bugatti|maybach|porsche|koenigsegg|pagani)/i;
      let wow = "";
      if (!said && ((age && !isNaN(km) && km > 0 && km / age < 8000) || LUX.test(String(estMake)))) wow = "Nice,";
      if (wow && replyParts.length === 1 && !/^no problem/i.test(replyParts[0]) && /\?\s*$/.test(replyParts[0]) && !/you'?re booked/i.test(replyParts[0])) {
        const q = replyParts[0].replace(/^(great|alright|got it|thanks|nice|okay|ok)[!.,]?\s*/i, "");
        replyParts[0] = `${wow} ${q.charAt(0).toLowerCase() + q.slice(1)}`; // "Nice, is there any outstanding mortgage on the car?"
      }
    }
    // Natural, varied openers (Marc): "Great", "Alright", "Got it"… — never the same one twice in a row
    {
      const OPENERS = ["Great!", "Alright.", "Got it.", "Thanks!", "Okay."];
      const recentA = history.filter(m => m.role === "assistant").slice(-3).map(m => m.content.toLowerCase());
      const usedRecently = (o: string) => recentA.some(t => t.startsWith(o.slice(0, -1).toLowerCase()));
      const lastSent = [...history].reverse().find(m => m.role === "assistant")?.content ?? "";
      const lastOpener = OPENERS.find(o => lastSent.toLowerCase().startsWith(o.slice(0, -1).toLowerCase()));
      const p0 = replyParts[0] ?? "";
      const startsBare = /^(could|what|is|are|when|which|how|do|does|and|mileage|any)\b/i.test(p0);
      const startsOpener = /^(great|alright|got it|thanks|thank you|nice|okay|ok|perfect|sure|of course)\b/i.test(p0);
      if (replyParts.length === 1 && startsBare && history.length >= 2) {
        const choices = OPENERS.filter(o => !usedRecently(o));
        const pick = (choices.length ? choices : OPENERS.filter(o => o !== lastOpener))[history.filter(m => m.role === "assistant").length % Math.max(1, choices.length || 5)];
        replyParts[0] = `${pick ?? "Great!"} ${p0}`;
      } else if (replyParts.length >= 1 && startsOpener && lastOpener && p0.toLowerCase().startsWith(lastOpener.slice(0, -1).toLowerCase())) {
        const choices = OPENERS.filter(o => o !== lastOpener);
        replyParts[0] = p0.replace(/^(great|alright|got it|thanks|thank you|nice|okay|ok)[!.,]?/i, choices[history.length % choices.length]);
      }
    }
    // They said a later timeframe ("within 10 days", "next week") → never push for today; ask for a day (Marc)
    {
      const userT = [...history.filter(m => m.role === "user").map(m => m.content), messageText];
      const LATER = /\b(this|next)\s+week\b|\b(with\s*in|in|next|coming)\s+(a\s+|the\s+)?(few|couple( of)?|\d+|two|three|four|five|ten)\s+(days|weeks|months?)\b|\bfew days\b|\bnext month\b|\bweekend\b/i;
      const URGENT = /\b(today|now|right now|asap|a\.s\.a\.p|immediately|urgent(ly)?|this (afternoon|evening))\b/i;
      if (!appointmentConfirmedEarly && userT.some(t => LATER.test(t)) && !userT.some(t => URGENT.test(t))) {
        replyParts = replyParts.map(p => {
          if (!/\btoday\b/i.test(p) || !/\?/.test(p) || /or else later/i.test(p)) return p;
          const out = p.replace(/[^.!?\n]*\btoday\b[^.!?\n]*\?/gi, "").replace(/[^.!?\n]*\btoday\b[^.!?\n]*[.!]/gi, "").trim();
          const lastSentA = [...history].reverse().find(m => m.role === "assistant")?.content ?? "";
          if (out && /which day (would be good|works|do you prefer)/i.test(lastSentA)) return out; // don't ask the same day question twice in a row
          return `${out ? out + "\n\n" : ""}Which day would be good for you?`;
        });
      }
    }
    // Already booked → never ask for a day/time again in answers to follow-up questions
    if (!appointmentConfirmedEarly && hasBooking && currentStep >= CLOSING_STEP) {
      replyParts = replyParts.map(p => p.replace(/[^.!?\n]*\b(what time (can|would|is best|works)|which (day|time) (would|works|do you)|when can you come)[^.!?\n]*\?/gi, "").trim()).filter(Boolean);
    }
    // Sharing our number is not permission to call the customer. Keep the chat
    // closed after extra details, while still answering a new question.
    if (!appointmentConfirmedEarly && currentStep >= CLOSING_STEP
        && String((conversation as any).car_conditions ?? "").includes("CUSTOMER WILL CALL:")
        && !String((conversation as any).car_conditions ?? "").includes("CUSTOMER WILL CALL: Requested a team callback")) {
      const askedQuestion = /\?|^\s*(what|when|where|how|do|does|are|is|can|could|which)\b/i.test(messageText);
      if (!askedQuestion) {
        replyParts = []; // No new question or explicit choice: the conversation is closed.
      } else {
        replyParts = replyParts.map(p => p
          .replace(/[^.!?\n]*\b(?:our team|someone from our team)\s+(?:will|can|is going to)\s+(?:call|contact|be in touch)[^.!?\n]*[.!?]/gi, "")
          .replace(/[^.!?\n]*\b(?:we(?:'ll| will))\s+(?:call|contact|be in touch)[^.!?\n]*[.!?]/gi, "")
          .trim()).filter(Boolean);
        if (!replyParts.length) replyParts = ["You can call us on +971 58 582 5543 whenever you're ready."];
      }
    }
    console.log(`[kaya] reply ready for ${phone} after ${Math.round((Date.now() - t0) / 1000)}s`);
    for (const part of replyParts) {
      await sendWhatsAppMessage(phone, part);
    }
    // Save exactly what was sent (openers, "Nice,", day-question fixes…) — the history is Kaya's context
    reply = replyParts.join("\n[SPLIT]\n");

    if (appointmentConfirmedEarly) {
      if (LOCATION_IMAGE_URL) await sendWhatsAppImage(phone, LOCATION_IMAGE_URL);
      await sendWhatsAppMessage(phone, LOCATION_TEXT);
      // The name is collected before confirmation; request an alternate number only when needed.
      const nameNow = (coreUpdates as any).name ?? conversation.name ?? nameFromHistory([...history, { role: "user", content: messageText }]);
      const after = !nameNow ? null : !isUAE ? POST_PHONE_Q : null;
      if (after) { await sendWhatsAppMessage(phone, after); reply = `${reply}\n[SPLIT]\n${after}`; }
    }

    if (action?.type === "OFFER_CALLBACK" && reply) {
      // Marc: confirm the number (UAE WhatsApp) or ask for one (non-UAE)
      await sendWhatsAppMessage(phone, isUAE ? "They can reach you on this same number, correct?" : POST_PHONE_Q);
    }

    try {
      const updatedHistory: ConversationMessage[] = [
        ...history,
        { role: "user"      as const, content: messageText },
        ...(reply ? [{ role: "assistant" as const, content: reply }] : []),
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
    // Only stay on the sell-method step when they ask for an explanation.
    // "Not sure" moves on to booking — the best way to sell is decided after the inspection.
    const stayAtSellMethod   = currentStep === 6 && (asksBestWayToSell(messageText) || /\b(difference|explain|what'?s the|how does|which is better|options?)\b/i.test(messageText))
      && !/\b(not sure|unsure|don'?t know|undecided|no idea|think about it|either)\b/i.test(messageText)
      && !SELL_METHOD_CASH.test(messageText) && !SELL_METHOD_CONSIGNMENT.test(messageText);
    const promisedCallback = !appointmentConfirmed && currentStep >= 5 &&
      /\b(team|someone)\b[^.]{0,60}\b(be in touch|reach out|call you|contact you|get back to you)/i.test(reply);
    const nextStep = askOrigin ? currentStep
      : promisedCallback ? CLOSING_STEP
      : currentStep >= CLOSING_STEP ? (isRebook && !appointmentConfirmed ? FINAL_STEP : CLOSING_STEP)
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
    const teamFollowUp = !appointmentConfirmed && !!reply &&
      (action?.type === "OFFER_CALLBACK" || TEAM_FOLLOWUP.test(reply));

    if (appointmentConfirmed) {
      const sellTl = (await getConversation(phone).catch(() => null))?.sell_timeline ?? "";
      const salesInquiry = /sell_method:consignment/.test(sellTl) ? "Consignment"
        : /sell_method:cash/.test(sellTl) ? "Cash Deal" : "Not Sure - Need Advise";
      const rescheduled = isRebook && hasBooking;
      await pushLead(phone, rescheduled ? "booking rescheduled" : "booking confirmed", {
        salesInquiry, inspectionBooked: true, altPhone,
        milestone: rescheduled ? "RESCHEDULE" : "DUPLICATE",
        ...(rescheduled ? {
          topNote: `RESCHEDULED — was ${apptLabel(conversation.appointment_date, conversation.appointment_time)}, now ${apptLabel(apptDate, apptTime)}.`,
        } : {}),
      });
    } else if (teamFollowUp) {
      // Only the first follow-up promise in this chat is a new record; later ones update it
      const priorFollowUp = history.some(m => m.role === "assistant" && TEAM_FOLLOWUP.test(m.content));
      await pushLead(phone, "team follow-up", {
        salesInquiry: pricePushCount > 0 || PRICE_PUSH.test(messageText) ? "Price Offer Inquiry" : undefined,
        milestone: priorFollowUp ? undefined : "FOLLOW UP",
      });
    }

    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch (error) {
    console.error("Webhook POST error:", error);
    // Retry storage failures; do not replay an already committed customer message.
    return NextResponse.json({ status: "error" }, { status: inboundCommitted ? 200 : 503 });
  } finally {
    if (claimedPhone) await updateConversation(claimedPhone, { processing_until: null } as any).catch(() => {});
  }
}
