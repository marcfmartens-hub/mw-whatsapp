import {mileageClarification} from "@/lib/kaya-improve/policy-checks";
import {LOCATION_TEXT,CUSTOMER_CALL_CHOICE,wantsOurNumber} from "@/lib/kaya-improve/contact";
import { handleConversationTurn } from "@/lib/conversation-turn";
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

    const status = await handleConversationTurn(conversation,
      messageText || (mediaInBurst ? "[photo]" : message.type === "location" ? "Where is your location?" : "[unsupported]"));
    return NextResponse.json({ status }, { status: 200 });
  } catch (error) {
    console.error("Webhook POST error:", error);
    // Retry storage failures; do not replay an already committed customer message.
    return NextResponse.json({ status: "error" }, { status: inboundCommitted ? 200 : 503 });
  } finally {
    if (claimedPhone) await updateConversation(claimedPhone, { processing_until: null } as any).catch(() => {});
  }
}
