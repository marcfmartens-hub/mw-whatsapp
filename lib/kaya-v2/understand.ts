// Kaya v2 — reading a customer message.
// AI (Haiku) only READS the message into fields. It never writes Kaya's reply: the flow does that.
import type { QuestionKey } from "./replies";

export type Understanding = {
  ack_only: boolean;                 // "ok", "thanks", "👍" and nothing else
  name: string | null;               // the customer's OWN name, only when stated
  car: {
    make: string | null; model: string | null; year: string | null;
    mileage_km: number | null;
    specs: "GCC" | "Non-GCC" | "Unknown" | null;
    loan: "yes" | "no" | null;
  };
  more_cars: boolean;                // more than one car to sell
  vehicle_kind: "car" | "truck_bus" | "other_vehicle" | null;
  hiyaza: boolean;
  wants_to_sell: boolean;
  buyer_only: boolean;               // wants to BUY a car, nothing to sell
  not_a_lead: boolean;               // service offers, ads, job seekers, asking for the owner/staff
  sell_timing: { stated: boolean; days_until: number | null; undecided: boolean };
  visit: {
    date: string | null;             // YYYY-MM-DD in Dubai
    time: string | null;             // HH:MM 24h
    part_of_day: "morning" | "afternoon" | "evening" | null;
    flexible: boolean;               // "any time", "asap", "whenever you want"
    tentative: boolean;              // "Saturday maybe"
  };
  yes_no: "yes" | "no" | null;       // answer to a yes/no question Kaya just asked
  wants_booking: boolean;
  wants_person: boolean;
  questions: QuestionKey[];
  hard_requirement: boolean;         // refuses to continue without price/estimate or home visit
  change_request: "reschedule" | "cancel" | null;
  phone_number: string | null;
};

export const EMPTY: Understanding = {
  ack_only: false, name: null,
  car: { make: null, model: null, year: null, mileage_km: null, specs: null, loan: null },
  more_cars: false, vehicle_kind: null, hiyaza: false, wants_to_sell: false, buyer_only: false, not_a_lead: false,
  sell_timing: { stated: false, days_until: null, undecided: false },
  visit: { date: null, time: null, part_of_day: null, flexible: false, tentative: false },
  yes_no: null, wants_booking: false, wants_person: false, questions: [], hard_requirement: false,
  change_request: null, phone_number: null,
};

const QUESTION_KEYS: QuestionKey[] = ["price", "home_visit", "free", "commission", "hours", "location", "how_it_works", "payment", "documents", "loan", "expired_registration", "not_running", "company_car", "lost_mulkiya", "other_emirate", "duration", "accident", "are_you_bot", "other"];

export const SYSTEM = `You read WhatsApp messages sent to Mister Wheelz, a Dubai company that BUYS used cars. Customers book a free 10–15 minute inspection at the branch.
You do NOT reply to the customer. You only turn the latest customer message into JSON for the booking system. Wrong data is worse than missing data: when unsure, use null/false.

Return ONLY this JSON object:
{
 "ack_only": bool,          // the message is only "ok", "thanks", "welcome", an emoji, or similar, with no new information
 "name": string|null,       // the customer's OWN first name or full name, only if they state it ("I'm Asif", "this is Asif", "Hi, Evgeniy") or answer Kaya's name question with a name. Never a car, a place, a time ("as soon as possible", "this week"), a greeting or a friend's name.
 "car": {
   "make": string|null, "model": string|null, "year": string|null,   // canonical spelling ("Toyata"→"Toyota", "Hundyi Toucan"→Hyundai Tucson, "Changing alsvin"→Changan Alsvin). If the customer writes "2015 model", that is the YEAR.
   "mileage_km": number|null,   // odometer in km. "130k"=130000. UAE customers often drop the thousands: "200" or "145" for a car older than 2 years means 200000/145000. Never a price or a year.
   "specs": "GCC"|"Non-GCC"|"Unknown"|null,   // "American", "USA", "Japan origin", "Indian spec", "non GCC" → Non-GCC. "I don't know" → Unknown. Only if stated.
   "loan": "yes"|"no"|null      // car loan / mortgage / finance on the car
 },
 "more_cars": bool,         // customer wants to sell more than one car
 "vehicle_kind": "car"|"truck_bus"|"other_vehicle"|null,  // other_vehicle = motorbike, boat, jet ski, trailer, equipment
 "hiyaza": bool,            // car under Hiyaza (ownership certificate only, no plates/insurance)
 "wants_to_sell": bool,     // says they want to sell a car, or describes a car for sale
 "buyer_only": bool,        // wants to BUY a car from us and has nothing to sell
 "not_a_lead": bool,        // not about selling a car: service/advertising/loan offers, job requests, asking for the owner or a staff member by name, spam. A car listing pasted from an ad by a seller IS a lead.
 "sell_timing": {
   "stated": bool,          // they said when they want to sell
   "days_until": number|null,   // days from today until they want to sell. now/today/immediately/asap/any time/"if the price is right" = 0, tomorrow = 1, this week = 3, next week = 7, this month = days left in the month, "end of month"/"25th Nov" = exact days, next month = 30
   "undecided": bool        // "not sure yet", "I'll let you know", "just checking"
 },
 "visit": {                 // when they can COME to the branch for the inspection (not when they sell)
   "date": "YYYY-MM-DD"|null,   // resolve today/tomorrow/weekday names against TODAY below. If Kaya just offered a day and they only give a time, use Kaya's day.
   "time": "HH:MM"|null,        // 24h. "first one"/"the earlier one" = the first time Kaya offered. "after 5 pm" = "18:00".
   "part_of_day": "morning"|"afternoon"|"evening"|null,
   "flexible": bool,        // "any time", "whenever", "as soon as possible", "you tell me", "let me know whenever you think is appropriate"
   "tentative": bool        // unsure: "Saturday maybe", "probably Monday"
 },
 "yes_no": "yes"|"no"|null, // only when Kaya's last message asked a yes/no question
 "wants_booking": bool,     // asks to book / come / arrange the inspection
 "wants_person": bool,      // wants a call, a human, the team, not a bot
 "questions": [..],         // every question or objection in the message, from: ${QUESTION_KEYS.join(", ")}
                            // price = asks price, offer, estimate, valuation, "how much", or states an asking price as a demand. home_visit = asks us to come to them, home inspection, "will they come to my location", "I will not come". location = where are you / send location. hours = opening/working hours. free = "is the inspection free". how_it_works = "how does it work", "guide me through the process". other = any other question.
 "hard_requirement": bool,  // they make price/estimate or a home visit a CONDITION: "first tell me the price, otherwise no", "I will not come", "only if you come to me", or they repeat the same demand after Kaya already answered it
 "change_request": "reschedule"|"cancel"|null,  // only about an existing booked appointment
 "phone_number": string|null  // a contact phone number written in the message, digits with country code if given
}

Notes:
- The first message is often a pre-filled ad text in any language ("Hello! Can I get more info on this?", "مرحبًا! هل يمكنني الحصول على مزيد من المعلومات حول هذا؟", "🚘 What is your car make, model & Year?"). That is NOT a question to answer: questions=[] and nothing else set.
- Read the whole message, also when it answers a different question than Kaya asked. Several short messages may be joined with newlines; read them together.
- [photo], [file], [audio] mark attachments you cannot see. Ignore them.`;

const str = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);
const bool = (v: any) => v === true;

export function normalize(raw: any): Understanding {
  const r = raw && typeof raw === "object" ? raw : {};
  const car = r.car && typeof r.car === "object" ? r.car : {};
  const st = r.sell_timing && typeof r.sell_timing === "object" ? r.sell_timing : {};
  const v = r.visit && typeof r.visit === "object" ? r.visit : {};
  const km = typeof car.mileage_km === "number" ? car.mileage_km : Number(String(car.mileage_km ?? "").replace(/[^\d.]/g, "")) || null;
  const year = str(car.year)?.match(/\b(19[89]\d|20[0-3]\d)\b/)?.[1] ?? null;
  return {
    ack_only: bool(r.ack_only),
    name: str(r.name),
    car: {
      make: str(car.make), model: str(car.model), year,
      mileage_km: km && km > 0 && km < 2_000_000 && !(km >= 1990 && km <= 2035 && !/k|km/i.test(String(car.mileage_km))) ? Math.round(km) : null,
      specs: ["GCC", "Non-GCC", "Unknown"].includes(car.specs) ? car.specs : null,
      loan: car.loan === "yes" || car.loan === "no" ? car.loan : null,
    },
    more_cars: bool(r.more_cars),
    vehicle_kind: ["car", "truck_bus", "other_vehicle"].includes(r.vehicle_kind) ? r.vehicle_kind : null,
    hiyaza: bool(r.hiyaza),
    wants_to_sell: bool(r.wants_to_sell),
    buyer_only: bool(r.buyer_only),
    not_a_lead: bool(r.not_a_lead),
    sell_timing: {
      stated: bool(st.stated),
      days_until: typeof st.days_until === "number" && st.days_until >= 0 ? Math.round(st.days_until) : null,
      undecided: bool(st.undecided),
    },
    visit: {
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(v.date)) ? v.date : null,
      time: /^\d{2}:\d{2}$/.test(String(v.time)) ? v.time : null,
      part_of_day: ["morning", "afternoon", "evening"].includes(v.part_of_day) ? v.part_of_day : null,
      flexible: bool(v.flexible), tentative: bool(v.tentative),
    },
    yes_no: r.yes_no === "yes" || r.yes_no === "no" ? r.yes_no : null,
    wants_booking: bool(r.wants_booking),
    wants_person: bool(r.wants_person),
    questions: Array.isArray(r.questions) ? [...new Set(r.questions.filter((q: any) => QUESTION_KEYS.includes(q)))] as QuestionKey[] : [],
    hard_requirement: bool(r.hard_requirement),
    change_request: r.change_request === "reschedule" || r.change_request === "cancel" ? r.change_request : null,
    phone_number: str(r.phone_number)?.replace(/[^\d+]/g, "") || null,
  };
}

export function contextBlock(now: Date, lastKaya: string, known: Record<string, any>): string {
  const local = new Date(+now + 4 * 3600e3);
  const today = local.toISOString().slice(0, 10);
  const weekday = local.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  const facts = Object.entries(known).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(", ");
  return `TODAY (Dubai): ${weekday} ${today}, ${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}
Already known: ${facts || "nothing"}
Kaya's last message: ${lastKaya ? JSON.stringify(lastKaya.slice(0, 600)) : "(none — this is the first message)"}`;
}

/** Calls Haiku. `call` is injectable so tests and replays can run without the network. */
export async function understand(
  text: string,
  ctx: { now: Date; lastKaya: string; known: Record<string, any> },
  call: (system: string, user: string) => Promise<string>,
): Promise<{ u: Understanding; ok: boolean }> {
  if (!text.trim()) return { u: EMPTY, ok: true };
  try {
    const out = await call(SYSTEM, `${contextBlock(ctx.now, ctx.lastKaya, ctx.known)}\n\nCustomer message:\n<<<${text.slice(0, 2000)}>>>\n\nReturn only the JSON object.`);
    const json = out.match(/\{[\s\S]*\}/)?.[0];
    if (!json) throw new Error("no JSON");
    return { u: normalize(JSON.parse(json)), ok: true };
  } catch (e) {
    console.error("[kaya-v2] understand failed:", e);
    return { u: await fallback(text, ctx.now, ctx.known), ok: false };
  }
}

// Used only when the AI call fails: simple pattern reading so the chat can still move on.
async function fallback(text: string, now: Date, known: Record<string, any>): Promise<Understanding> {
  const { dateFromText, timeFromText, supportedVehicle } = await import("../conversation-state");
  const v = supportedVehicle(text, { make: known.make, model: known.model, year: known.year, mileage: known.mileage });
  const u: Understanding = JSON.parse(JSON.stringify(EMPTY));
  if (v.make !== known.make) u.car.make = v.make ?? null;
  if (v.model !== known.model) u.car.model = v.model ?? null;
  if (v.year !== known.year) u.car.year = v.year ?? null;
  if (v.mileage !== known.mileage && v.mileage) u.car.mileage_km = Number(v.mileage);
  if (/\bnon[- ]?gcc|american|usa?\b|japan|canad/i.test(text)) u.car.specs = "Non-GCC";
  else if (/\bgcc\b/i.test(text)) u.car.specs = "GCC";
  u.visit.date = dateFromText(text, now) ?? null;
  u.visit.time = timeFromText(text, false) ?? null;
  u.visit.flexible = /\b(any ?time|asap|as soon as possible|whenever)\b/i.test(text);
  u.ack_only = /^\s*(ok(ay)?|thanks?|thank you|welcome|👍|🙏|sure)[.!\s]*$/i.test(text);
  u.yes_no = /^\s*(yes|yeah|yep|sure|ok(ay)?)\b/i.test(text) ? "yes" : /^\s*no\b/i.test(text) ? "no" : null;
  if (/how much|price|offer|estimate|valuation/i.test(text)) u.questions.push("price");
  if (/home (visit|inspection)|come to (me|my)|my location/i.test(text)) u.questions.push("home_visit");
  if (/where are you|location|address/i.test(text)) u.questions.push("location");
  u.wants_person = /\b(call ?back|call me|human|person|agent)\b/i.test(text);
  u.wants_to_sell = /\bsell|sale\b/i.test(text) || !!u.car.make;
  return u;
}

export async function haikuCall(system: string, user: string): Promise<string> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY as string, timeout: 20000, maxRetries: 1 });
  const r = await client.messages.create({
    model: "claude-haiku-5-5",
    max_tokens: 700,
    thinking: { type: "disabled" },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
  } as any);
  const block = (r.content as any[]).find((b) => b.type === "text");
  return block?.text ?? "";
}
