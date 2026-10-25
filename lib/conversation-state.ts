import { CAR_MAKES, CAR_MODELS } from "./carData";
import { specsStatement, mulkiyaAnswer, MULKIYA_QUESTION } from "./specs";

export type Status = "collecting" | "visit_proposed" | "awaiting_confirmation" | "booked" | "default_pending" | "reconfirmation" | "team_accepted" | "customer_will_contact" | "closed";
export const STATUS_LABELS: Record<Status, string> = {
  collecting: "Collecting details", visit_proposed: "Visit proposed", awaiting_confirmation: "Awaiting customer confirmation",
  booked: "Booked", default_pending: "Default slot — CC confirmation pending", reconfirmation: "Reconfirmation needed",
  team_accepted: "Team follow-up accepted", customer_will_contact: "Customer will contact us", closed: "Closed / not a selling enquiry",
};
export type Vehicle = { make?: string; model?: string; year?: string; mileage?: string; specs?: string };
export type FlowState = {
  version: 1; status: Status; question?: string; proposedDate?: string; proposedTime?: string;
  previousDate?: string; previousTime?: string; mulkiyaPending?: boolean; specsChecked?: boolean;
  consent?: "accepted" | "declined" | "pending"; priceRequests?: number; mediaExplained?: boolean;
  vehicles?: Vehicle[]; part?: "morning" | "afternoon" | "evening"; timeMin?: number; timeMax?: number;
  pendingTask?: { date: string; time: string; request: string };
  customerAgreedSlot?: boolean;
  askedFields?: Record<string, boolean>;
};
export type Chat = Record<string, any> & { messages?: { role: string; content: string }[] | null };
export type Turn = { updates: Record<string, any>; state: FlowState; reply: string; confirm?: boolean; crm?: "lead" | "booking" | "change"; defaultDate?: string };
const CONFIRMED = /you'?re booked for|I've booked your inspection|I'll book you for/i;
const HESITATION = /\b(maybe|perhaps|let me (?:check|think)|i (?:will|'ll) (?:check|try|inform|update)|i'?ll let you know|will (?:update|inform)|if i have time|once i'?m (?:free|ready)|when (?:i'?m|i am|will i'?m) ready|not (?:today|tomorrow|possible)|can'?t (?:come|make it)|cannot come)\b/i;
const SELF_CONTACT = /\b(?:i\s*(?:will|shall)|i'?ll)\s+(?:call|contact|phone|ring)(?:\s+(?:you|them|the team|us))?\b|\bwill contact you\b/i;
const YES = /^\s*(?:yes(?: please)?|yes sure|sure|sure please|okay|ok|please|that (?:will|would) be (?:good|great)|works(?: for me)?|yes[.! ]+sure)[\s.!👍]*$/i;
const NO = /^\s*(?:no(?: thanks)?|nope|not interested|no need|don't call|do not call)[\s.!]*$/i;
const PRICE = /\b(how much|price|offer|estimate|valuation|ballpark|worth|what.*pay)\b/i;
const LOCATION_REQUEST = /\b(where|location|locating|locations?|loction|loctb|loctn|loct|address|map|directions)\b/i;
export const LOCATION = "📍 Mister Wheelz Car Buyers\nUmm Suqeim Branch, Al Quoz 4, Dubai\nhttps://maps.app.goo.gl/nv6Yy7uKqVCnkcVx6\nMon–Sat 10 AM–7 PM (Friday from 12 PM); closed Sunday\nCustomer service: +971 58 582 5543";
const CONTACT_NUMBER = "+971 58 582 5543";
const CHOICE = "Would you like to arrange the inspection, or would you prefer a personal call from our purchasing team?";
const lastAssistant = (c: Chat) => [...(c.messages ?? [])].reverse().find(m => m.role === "assistant")?.content ?? "";
const namedWords = new Set([...Object.keys(CAR_MAKES), ...Object.values(CAR_MAKES), ...Object.values(CAR_MODELS).flat()].flatMap(s => [s.toLowerCase(), ...s.toLowerCase().split(/\s+/)]));
const NOT_NAME = /^(?:only|under|finance|financed|loan|usa?|gcc|non|american|korean|japanese|german|canadian|specs?|hi|hello|hey|yes|no|sure|okay|ok|thanks?|please|call|contact|price|offer|cash|selling|sell|sale|buy|car|cars|model|year|morning|afternoon|evening|today|tomorrow|now|early|asap|available|ready|busy|owner|registered|company|name|i|im|am|my|the|is|it|here|when|want|need|not|still|with|without|under|warranty|petrol|diesel|free|good|fine|new|used|noon|mileage|km|tomorrow|saturday|sunday|monday|tuesday|wednesday|thursday|friday)$/i;
export function validName(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z'-]*(?:\s+[a-z][a-z'-]*){0,3}$/i.test(value.trim()) && value.length <= 60
    && value.trim().split(/\s+/).every(w => !NOT_NAME.test(w) && !/^(?:great|perfect|noted|understood|sold|bro|brother|dear|sir|madam|in|at|on|to|for|from|of|and|or|but|me|you|your|we|they|them|this|that|will|would|could|can|have|has|got|do|does|don't|not|just|let|looking|leaving|coming|going|bring|arrive|selling|thinking|working|driving|planning|visit|send|share|location|address|number|tell|know|there|thanks|thank|please|person|soon|approx|as|possible|immediately|later|next|week|month|before|after|when|want|no|yes|under|finance|fully|option|insurance|warranty|fines|registration|american|european|gulf|japan|korea|china|germany|uk|uae|us|seats|seat|cover|covers)$/i.test(w) && !namedWords.has(w.toLowerCase()));
}
const title = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, x => x.toUpperCase());
export function findName(text: string, c: Chat, question: string): string | undefined {
  const explicit = text.match(/\b(?:my name(?: is)?|name is|call me|this is|i am|i'm|car under)\s+([a-z][a-z'-]*(?:[ \t]+[a-z][a-z'-]*){0,3})/i)?.[1];
  if (explicit && validName(explicit)) return title(explicit);
  if (validName(c.name)) return c.name;
  for (const line of text.replace(/\[(?:unsupported|photo|file)\]/gi, "").split(/\n+/)) {
    const value = line.trim().replace(/^(?:mr\.?|mrs\.?|ms\.?)\s+/i, "").replace(/\s+here\s*$/i, "");
    if (validName(value) && (question === "name" || c.messages?.some(m => m.role === "assistant" && /your name/i.test(m.content)) || /\bhere\b/i.test(line) || /^[A-Z][a-z'-]+$/.test(value) || value.split(/\s+/).length >= 2)) return title(value);
  }
  return undefined;
}
export function expectedPrice(text: string): number | null {
  // Units belong to the number immediately beside them; "100750 km" is never money.
  const match = text.match(/\b(?:asking(?:\s+price)?|(?:want|need)(?:\s+(?:at least|last))?|expect(?:ing)?|minimum|at least|demand)\s*(?:(?:price|aed|dhs|of|is)\s*[:=-]?\s*)?(\d[\d,]*(?:\.\d+)?)\s*(k\b|thousand\b)?\s*(aed|dhs|dirhams?)?\b/i);
  if (!match || /^\s*(?:km\b|kms\b|kilomet|miles?\b|lakh\b)/i.test(text.slice(match.index! + match[0].length))) return null;
  if (/\b(loan|mortgage|balance|bank|owe|finance)\b/i.test(text.slice(Math.max(0, match.index! - 30), match.index! + match[0].length))) return null;
  const amount = Number(match[1].replace(/,/g, "")) * (match[2] ? 1000 : 1);
  if (!match[2] && !match[3] && /^(?:19|20)\d{2}$/.test(match[1])) return null;
  return amount >= 1000 && amount <= 10_000_000 ? amount : null;
}
export function flowState(c: Chat): FlowState {
  if (c.flow_state?.version === 1 && c.flow_state.status in STATUS_LABELS) return structuredClone(c.flow_state);
  const messages = c.messages ?? [];
  let conf = -1; messages.forEach((m, i) => { if (m.role === "assistant" && CONFIRMED.test(m.content)) conf = i; });
  const after = messages.slice(conf + 1).filter(m => m.role === "user").map(m => m.content).join("\n");
  const notes = String(c.car_conditions ?? "");
  const status: Status = SELF_CONTACT.test(after) ? "customer_will_contact"
    : conf >= 0 && HESITATION.test(after) ? "reconfirmation"
    : conf >= 0 && c.appointment_date && c.appointment_time ? (/I've booked your inspection/i.test(messages[conf].content) ? "default_pending" : "booked")
    : /CUSTOMER WILL CALL:.*no callback|Declined personal call/i.test(notes) ? "customer_will_contact"
    : /Accepted personal call|Asked to speak to the team/i.test(notes) ? "team_accepted"
    : c.appointment_date ? "visit_proposed" : "collecting";
  return { version: 1, status, proposedDate: c.appointment_date || undefined, proposedTime: c.appointment_time || undefined,
    mulkiyaPending: /Mulkiya specs check pending/.test(notes), specsChecked: /Specs unknown:|Specs conflict:|Mulkiya engine number/.test(notes) };
}
export function inspectionBooked(c: Chat): boolean { return flowState(c).status === "booked"; }
const iso = (d: Date) => d.toISOString().slice(0, 10);
const mins = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
export function slotValid(date: string, time: string, now = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || +time.slice(3) >= 60) return false;
  const d = new Date(`${date}T12:00:00Z`), local = new Date(+now + 4 * 3600e3);
  if (!Number.isFinite(+d) || iso(d) !== date || date < iso(local) || d.getUTCDay() === 0) return false;
  return mins(time) >= (d.getUTCDay() === 5 ? 720 : 600) && mins(time) <= 1110 && (date !== iso(local) || mins(time) > local.getUTCHours() * 60 + local.getUTCMinutes());
}
export function dateFromText(text: string, now = new Date()): string | undefined {
  text = text.replace(/\bnot (?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, "");
  const local = new Date(+now + 4 * 3600e3), plus = (n: number) => iso(new Date(+local + n * 86400e3));
  const direct = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/); if (direct) return direct[1];
  if (/\b(?:day )?after tomorrow\b/i.test(text)) return plus(2);
  if (/\b(tomorrow|tmrw|tmr)\b/i.test(text)) return plus(1);
  if (/\b(today|tonight|now)\b/i.test(text)) return plus(0);
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const day = days.findIndex(d => new RegExp(`\\b${d}\\b`, "i").test(text));
  if (day >= 0) { let delta = (day - local.getUTCDay() + 7) % 7; if (/next week/i.test(text)) delta = (((8 - local.getUTCDay()) % 7) || 7) + ((day + 6) % 7); return plus(delta); }
  const ordinal = text.match(/\b(\d{1,2})(?:st|nd|rd|th)\b/);
  if (ordinal) { const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), +ordinal[1], 12)); if (iso(d) < iso(local)) d.setUTCMonth(d.getUTCMonth() + 1); if (d.getUTCDate() === +ordinal[1]) return iso(d); }
  if (/\bweekend\b/i.test(text)) return plus((6 - local.getUTCDay() + 7) % 7 + (/next weekend/i.test(text) ? 7 : 0));
  return undefined;
}
export function timeFromText(text: string, answeringTime = false): string | undefined {
  const match = text.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|o'?clock)\b/i)
    ?? (answeringTime ? text.trim().match(/^0?(\d{1,2})(\d{2})\s*(am|pm)\b/i) : null)
    ?? text.match(/\b(?:at|around|before|after)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b/i)
    ?? (answeringTime ? text.trim().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*$/) : null);
  if (!match) return undefined;
  let hour = +match[1]; const minute = +(match[2] ?? 0), meridian = (match[3] ?? "").toLowerCase();
  if (hour > 23 || minute > 59 || (meridian && hour > 12)) return undefined;
  if (meridian === "am" && hour === 12) hour = 0;
  else if (meridian === "pm" && hour < 12 || !/am|pm/.test(meridian) && hour >= 1 && hour <= 7) hour += 12;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
export function supportedVehicle(text: string, old: Vehicle, extracted: Vehicle = {}, question = ""): Vehicle {
  // Normalize common customer spellings without changing the original message.
  text = text.replace(/\btasla\b/gi, "Tesla").replace(/\bmille\b/gi, "mileage");
  if (/\bTesla\b/i.test(text)) text = text.replace(/\bX\s+model\b/gi, "Model X");
  const out: Vehicle = { ...old };
  const corrected = /\b(actually|correction|i mean|wrong|sorry)\b/i.test(text);
  const makes = [...new Set(Object.values(CAR_MAKES))];
  const modelPairs = Object.entries(CAR_MODELS).flatMap(([make, models]) => models.map(model => ({ make, model }))).sort((a, b) => b.model.length - a.model.length);
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = (v: string) => new RegExp(`(?<![a-z0-9])${escape(v)}(?![a-z0-9])`, "i").test(text);
  const make = makes.find(m => match(m) && (m !== "SEAT" || /\bseat\s+(?:leon|ibiza|arona|ateca|tarraco|toledo|alhambra)\b/i.test(text))) ?? (/\b(vw|volkswagen)\b/i.test(text) ? "Volkswagen" : /\b(chevy)\b/i.test(text) ? "Chevrolet" : undefined);
  if (old.make && make && make !== old.make && !corrected) return out;
  const model = modelPairs.find(p => match(p.model) && ((make || old.make) ? p.make === (make || old.make) : p.model.length >= 3 && /[a-z]/i.test(p.model)));
  if (make && (!old.make || corrected || make === old.make)) out.make = make;
  if (model && (!old.model || corrected || model.make === (make || old.make))) { out.model = model.model; out.make = model.make; }
  // The model-assisted extractor only supplements fields grounded in this message.
  if (extracted.make && match(extracted.make) && (!out.make || corrected)) out.make = extracted.make;
  if (extracted.model && match(extracted.model) && (!out.model || corrected)) out.model = extracted.model;
  const year = text.match(/\b(?:19[89]\d|20[0-3]\d)\b/)?.[0]; if (year && (!old.year || corrected)) out.year = year;
  let km = text.match(/\b(\d[\d,]*(?:\.\d+)?)[ \t]*(lakh|k(?![a-z])|kms?\b|kilomet\w*|miles?\b)/i);
  if (!km) km = text.match(/\b(\d[\d,]*(?:\.\d+)?)[ \t]*(thousand|million)\b/i);
  if (!km) km = text.match(/\b(?:mileage|kms?|odometer)[ \t.:=-]*(\d[\d,]*(?:\.\d+)?)[ \t]*(k)?\b/i);
  if (!km && question === "mileage" && !/\b(price|aed|loan|balance|model|year)\b/i.test(text)) km = text.match(/^\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?\s*(?:gcc)?\s*$/i);
  if (km) { const value = Number(km[1].replace(/,/g, "")); const unit = km[2] ?? ""; const n = value * (/lakh/i.test(unit) ? 100000 : /million/i.test(unit) ? 1000000 : /thousand/i.test(unit) ? 1000 : /^k$/i.test(unit) && value < 1000 ? 1000 : 1); if (n > 0 && n <= 2_000_000 && (!old.mileage || corrected)) out.mileage = String(n); }
  return out;
}

export function planTurn(c: Chat, raw: string, extracted: Vehicle = {}, now = new Date()): Turn {
  const state = flowState(c), text = raw.replace(/[’‘]/g, "'").replace(/\s*\(location pin already sent[^)]*\)/gi, "").trim();
  const previous = lastAssistant(c), local = new Date(+now + 4 * 3600e3);
  const inferredQuestion = /your name/i.test(previous) ? "name" : /outstanding balance/i.test(previous) ? "balance" : /any.*loan|mortgage on/i.test(previous) ? "loan" : /mileage/i.test(previous) ? "mileage" : /gcc.*right|specs.*\?/i.test(previous) ? "specs" : /what exact time/i.test(previous) ? "exact_time" : /what time/i.test(previous) ? "time" : /personal call|team to contact/i.test(previous) ? "callback" : undefined;
  const question = state.question ?? inferredQuestion ?? "";
  const updates: Record<string, any> = {};
  const end = (reply: string, q?: string, status?: Status, crm?: Turn["crm"]): Turn => {
    if (q !== undefined) state.question = q;
    if (status) state.status = status;
    const booked = state.status === "booked";
    updates.flow_state = state;
    updates.step = booked || ["default_pending", "team_accepted", "customer_will_contact", "closed"].includes(state.status) ? 8 : ["visit_proposed", "awaiting_confirmation", "reconfirmation"].includes(state.status) ? 7 : q === "name" ? 1 : q === "vehicle" ? 2 : q === "mileage" || q === "specs" ? 4 : q === "loan" || q === "balance" ? 5 : 6;
    updates.appointment_date = booked ? state.proposedDate : null;
    updates.appointment_time = booked ? state.proposedTime : null;
    return { updates, state, reply, crm: crm ?? (wasBooked && !booked ? "change" : undefined) };
  };
  const note = (value: string) => { updates.car_conditions = [updates.car_conditions ?? c.car_conditions, value].filter(Boolean).join(" | "); };
  const wasBooked = ["booked", "default_pending", "reconfirmation"].includes(state.status);
  const facts: Vehicle = { make: c.make || undefined, model: c.model || undefined, year: c.year || undefined, mileage: c.mileage || undefined, specs: c.specs || undefined };
  const name = findName(text, c, question);
  const newlyProvidedName = !!name && name !== c.name && !/^(?:name|my name|i am|i'm)$/i.test(text);
  if (name && name !== c.name) updates.name = name;
  // An out-of-order name is useful data, not a reason to repeat a question without acknowledgement.
  // Only acknowledge a new name when it was supplied in this turn.
  const nameAcknowledgement = newlyProvidedName ? `Thank you, ${name.split(" ")[0]}.` : "";
  const isMultiple = /\b(?:also (?:i )?(?:want to )?sell|(?:selling|sell|have) (?:a |one )?(?:second|another|one more) car|(?:two|2|multiple) cars (?:for sale|to sell))\b/i.test(text);
  if (isMultiple || question === "second_vehicle") {
    const otherText = text.split(/\b(?:one more car|another car|second car)\b/i).at(-1) || text;
    const second = supportedVehicle(otherText, state.vehicles?.[1] ?? {}, extracted, question);
    const primary = state.vehicles?.[0] ?? supportedVehicle(text.split(/\b(?:one more car|another car|second car)\b/i)[0], facts);
    state.vehicles = [primary, second];
    Object.assign(updates, primary);
    note(`Multiple vehicles for team review: ${JSON.stringify(state.vehicles)}. Customer message: ${text}`);
    state.consent = "pending";
    const missing = [!second.make ? "make" : "", !second.model ? "model" : "", !second.year ? "year" : "", !second.mileage ? "mileage" : ""].filter(Boolean);
    return end(`I'll keep the details of the two cars separate. ${wasBooked ? "Your existing inspection stays as arranged. " : ""}${missing.length ? `Could you type the second car's ${missing.join(" and ")}?` : "Our purchasing team can discuss both vehicles with you. May they call you on this WhatsApp number?"}`, missing.length ? "second_vehicle" : "callback", wasBooked ? state.status : "collecting", "lead");
  }
  const vehicle = supportedVehicle(text, facts, extracted, question);
  for (const k of ["make", "model", "year", "mileage"] as const) if (vehicle[k] && vehicle[k] !== facts[k]) updates[k] = vehicle[k];
  const price = expectedPrice(text); if (price !== null) note(`Customer expects: AED ${price.toLocaleString("en-US")}`);
  // Recognise urgent selling context without restarting the appointment-first flow.
  const departure = /(?:leav(?:e|ing)|depart(?:ing)?|mov(?:e|ing)|relocat(?:e|ing)|flying|going back|returning).{0,70}(?:country|uae|dubai|emirates|abroad|home)|(?:country|uae|dubai).{0,70}(?:leav(?:e|ing)|depart(?:ing)?|mov(?:e|ing)|relocat(?:e|ing))/i.test(text);
  const jobLoss = /(?:lost my job|job loss|laid off|redundan|terminated|lost my work)/i.test(text);
  const financial = /(?:financial (?:problem|difficult)|need (?:money|cash)|can't afford|cannot afford)/i.test(text);
  const urgent = /(?:urgent|asap|quick|fast|immediately|right away|today|tomorrow|before (?:friday|weekend)|have to sell|must sell|need to sell)/i.test(text);
  const situation = departure ? "I understand you're leaving the country and need to sell your car. We can help you arrange a quick sale." :
    jobLoss ? "I'm sorry to hear about your job situation. We can help you explore a quick sale." :
    financial ? "I understand. We can help you explore a quick sale, with payment possible the same day after inspection and agreeing a price." :
    urgent ? "Understood. We can help you arrange a quick sale, subject to inspection and agreeing a price." : "";
  const alreadyAcknowledged = (c.messages ?? []).slice(-8).some(m => m.role === "assistant" && /(?:leaving the country|job situation|explore a quick sale|arrange a quick sale)/i.test(m.content));
  const contextualIntro = situation && !alreadyAcknowledged ? situation : "";

  const prefix: string[] = contextualIntro ? [contextualIntro] : [];
  // A stated departure and need to sell is already a selling timeline.
  // Customers often write "going back home next week ... sell this weel".
  const deadlinePattern = /(?:sell|sale|sold).{0,100}(?:this wee[k|l]|before .*leave|asap|urgent|today|tomorrow)|this wee[k|l].{0,100}(?:sell|sale|sold)|(?:leaving|going back home|moving back|flying home|relocating).{0,120}(?:need to sell|have to sell|must sell|sell my car)/i;
  // Treat explicit seller deadlines as answered, even when mentioned in an earlier turn.
  const explicitSaleDay = /\b(?:sell|selling|sold|sale)\b.{0,90}\b(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|this week|next week|weekend|\d{1,2}(?:st|nd|rd|th)?(?:\s+of)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)\b/i;
  const urgentSalePattern = /\b(?:sell|selling|sale|sold)\b.{0,40}\b(?:quick(?:ly)?|fast|urgent(?:ly)?|asap|immediately|right away|today|tomorrow)\b|\b(?:quick(?:ly)?|fast|urgent(?:ly)?|asap|immediately)\b.{0,40}\b(?:sell|selling|sale|sold)\b/i;
  if (deadlinePattern.test(text) || urgentSalePattern.test(text) || explicitSaleDay.test(text)) updates.sell_timeline = text;
  if (!updates.sell_timeline && !c.sell_timeline) {
    const earlier = [...(c.messages ?? [])].reverse().find(m => m.role === "user" && (deadlinePattern.test(m.content) || urgentSalePattern.test(m.content) || explicitSaleDay.test(m.content)));
    if (earlier) updates.sell_timeline = earlier.content;
  }
  // When the seller answers a vehicle question with their situation instead,
  // explicitly return to the missing vehicle rather than jumping to mileage.
  if (contextualIntro && !vehicle.make && !wasBooked) {
    state.askedFields = { ...(state.askedFields ?? {}), vehicle: true };
    return end(contextualIntro + " Please let me know which car you're selling (make, model and year).", "vehicle", "collecting");
  }

  // Location requests are answered on their own, without repeating the inspection pitch.
  // Keep the pending appointment question so the next customer reply can supply a time.
  if (LOCATION_REQUEST.test(text)) {
    // Answer the interruption, then resume exactly the pending question.
    // Never repeat the sales explanation or restart the conversation.
    const pendingQuestion = state.question || question;
    const continuation: Record<string, string> = {
      time: "What time can you bring your car?",
      exact_time: "What time can you bring your car?",
      name: "May I know your name please?",
      vehicle: "Which car are you selling (make, model and year)?",
      mileage: "What's the mileage?",
      specs: "Is it GCC specs?",
      loan: "Does the car have a loan?",
      balance: "How much is left on the loan?",
      sell: "When are you planning to sell?"
    };
    const pendingBooking = pendingQuestion === "time" || pendingQuestion === "exact_time" || state.status === "visit_proposed";
    const followUpQuestion = pendingBooking ? "What time can you bring your car?" : continuation[pendingQuestion] || "";
    return end(LOCATION + (followUpQuestion ? "\n\n\n" + followUpQuestion : ""), pendingBooking ? "time" : pendingQuestion || undefined, pendingBooking ? "visit_proposed" : undefined);
  }
  if (/\b(free|fees?|charges?|commission|cost.*inspection)\b/i.test(text)) prefix.push("The inspection is free, takes 10–15 minutes, and there's no obligation to sell.");
  if (/\b(number|phone number|call you|call them)\b/i.test(text)) prefix.push(`Our customer service number is ${CONTACT_NUMBER}.`);
  if (/\b(?:do you buy|you buy cars|buy.*(?:yourself|your self|own stock))\b/i.test(text)) prefix.push("We buy cars directly. After the inspection and agreeing a price, our team handles the purchase and transfer.");
  if (/\b(?:documents|what.*bring|friend.*car|owner.*come|power of attorney)\b/i.test(text)) prefix.push("Please bring the Emirates ID and Mulkiya. The registered owner should attend, or a representative needs a valid power of attorney.");
  if (/\b(?:how.*process|how.*work|cash|bank transfer|payment)\b/i.test(text)) prefix.push("After the free inspection and agreeing a price, we handle the transfer and can pay by cash or bank transfer the same day.");
  if (/\b(?:consignment|selling options|best way to sell)\b/i.test(text)) prefix.push("A direct purchase offers a quicker sale after agreeing the inspected price. With consignment, we sell the car on your behalf; it can take longer. Our purchasing team can discuss which suits you.");
  if (/\b(?:opening|open|hours|timings|close)\b/i.test(text) && !prefix.includes(LOCATION)) prefix.push(LOCATION);
  const answer = (reply: string) => [...prefix, reply].filter(Boolean).join("\n\n");
  if (/\b(?:just (?:inquiring|enquiring|inquiry|inquire)|only (?:inquiring|enquiring)|not ready|husband (?:is )?not (?:here|available)|too far|location is (?:too )?far)\b/i.test(text)) {
    note("Not ready / objection: " + text);
    return end(answer(/\b(?:too far|location is .*far)\b/i.test(text) ? "I understand. We only inspect cars at our Al Quoz branch. Would another day work for you?" : "No problem. The inspection is free. Would you like to arrange a visit when you are ready?"), "time", "collecting");
  }
  if (SELF_CONTACT.test(text)) { state.consent = "declined"; note("CUSTOMER WILL CALL: No callback requested"); if (wasBooked) { state.previousDate = state.proposedDate; state.previousTime = state.proposedTime; } return end(answer(`Understood. Contact us on ${CONTACT_NUMBER} whenever you're ready.${wasBooked ? " Your visit will need reconfirming before we treat it as definite." : " Have a nice day!"}`), "", "customer_will_contact", wasBooked ? "change" : "lead"); }
  if (/\b(cancel|already sold|sold the car|not coming|stop messaging|do not contact|don't contact|unsubscribe|remove my number)\b/i.test(text) || NO.test(text) && question !== "loan" && question !== "specs" && question !== "mulkiya") { state.consent = "declined"; return end(answer("Understood. We won't continue the booking. You're welcome to contact us whenever you need us."), "", "closed", wasBooked ? "change" : "lead"); }
  if (!facts.make && /\b(looking for marc|speak to marc|seat covers?|microfiber|microfibre|selling accessories|motorbike|motorcycle|boats?)\b/i.test(text)) return end(`For ${/marc/i.test(text) ? "Marc or our team" : "enquiries outside selling a car"}, please contact customer service on ${CONTACT_NUMBER}.`, "", "closed", "lead");
  if (!vehicle.make && /\b(?:want to|looking to|wish to) buy\b/i.test(text)) return end("Our team handles buying enquiries personally. Would you like them to contact you?", "callback", "collecting", "lead");
  if (/\b(politic|religio|election|president|prime minister)\w*\b/i.test(text)) return end("I can help with selling your car. What would you like to know about that?", question);
  const explicitTeam = /\b(call me|contact me|purchasing team sounds good|team.*(?:call|contact)|(?:speak|talk).*human|real person|not a bot)\b/i.test(text);
  if (explicitTeam || question === "callback" && YES.test(text) || question === "choice" && /\b(team|call|contact|purchas)\w*\b/i.test(text)) { state.consent = "accepted"; note("NOT READY YET: Accepted personal call"); return end(answer("Thanks. Our purchasing team can contact you on this WhatsApp number to discuss the car."), "", "team_accepted", "lead"); }
  if (question === "choice" && YES.test(text)) return end(answer("Do you mean you would like to book an inspection, or receive a personal call?"), "choice");
  if (["team_accepted", "customer_will_contact", "closed"].includes(state.status) && !dateFromText(text, now) && !timeFromText(text, true) && !/\b(book|arrange.*inspection|can come|will come|want to sell)\b/i.test(text)) return end(answer(state.status === "team_accepted" ? "Thanks. I've recorded the details for our team to discuss with you." : "You're welcome to contact us whenever you're ready."), "");
  if (wasBooked && HESITATION.test(text) && !(dateFromText(text, now) && timeFromText(text, true) && !/\b(maybe|perhaps|if|try)\b/i.test(text))) { state.previousDate = state.proposedDate; state.previousTime = state.proposedTime; state.customerAgreedSlot = false; return end(answer("Understood. I'll mark the visit as needing reconfirmation. Let us know which day and time you can definitely attend."), "time", "reconfirmation", "change"); }
  if (/\b(hiyaza|hayaza|ownership certificate|without plates|no plates|truck|export certificate)\b/i.test(text)) { note(`Special handling required: ${text}`); return end(answer("This needs an arrangement with our team before bringing the vehicle. Would you like them to contact you on this number?"), "callback", wasBooked ? "reconfirmation" : "collecting", "lead"); }
  const spec = specsStatement(text, question === "specs" || /gcc.*\?/i.test(previous));
  if (state.mulkiyaPending) {
    if (/\[(photo|file|sent photos\/files)\]/i.test(text) && !text.replace(/\[[^\]]*\]/g, "").trim()) return end("I can't read the photo. Could you type what the engine-number field says, or tell me if you cannot check it?", "mulkiya");
    const check = mulkiyaAnswer(text); state.mulkiyaPending = false; state.specsChecked = true;
    updates.specs = check === "NON_GCC" ? "Non-GCC" : "Unknown"; vehicle.specs = updates.specs;
    note(check === "NON_GCC" ? "Non-GCC: Mulkiya engine number NONE/NIL/blank" : "Specs unknown: Mulkiya requires team verification");
    if (check === "NON_GCC") { updates.non_gcc_handoff = true; return end(answer("Thanks. As this is verified non-GCC, our team needs to review the details before an inspection is arranged. May they contact you?"), "callback", "collecting", "lead"); }
  } else if (spec === "CHECK_MULKIYA" && !state.specsChecked) { state.mulkiyaPending = true; updates.specs = "Unknown"; return end(answer(MULKIYA_QUESTION), "mulkiya"); }
  else if (spec === "GCC" || spec === "Unknown") { updates.specs = spec; vehicle.specs = spec; if (spec === "Unknown") state.specsChecked = true; }
  else if (question === "specs" && /^(?:yes|yes gcc|gcc)[.! ]*$/i.test(text)) { updates.specs = "GCC"; vehicle.specs = "GCC"; }
  else if (question === "specs" && /\b(?:unsure|not sure|don't understand|do not understand|i don't know|no idea|not certain)\b/i.test(text)) { updates.specs = "Unknown"; vehicle.specs = "Unknown"; state.specsChecked = true; }
  else if (question === "specs" && /^(?:unknown|not sure|don't know|no idea)[.! ]*$/i.test(text)) { updates.specs = "Unknown"; vehicle.specs = "Unknown"; state.specsChecked = true; }
  if (c.non_gcc_handoff || vehicle.specs === "Non-GCC") return end(answer("Our team needs to review the non-GCC details before arranging an inspection. Would you like a personal call?"), "callback", "collecting", "lead");
  const loanYes = /\b(?:under finance|on (?:a )?mortgage|yes.*loan|loan is there|still have.*loan|financed)\b/i.test(text) || question === "loan" && /^yes\b/i.test(text);
  // Extract explicit finance status even when bundled with make/model/mileage/specs.
  const explicitNoLoan = /\b(?:no\s+(?:outstanding\s+)?(?:loan|finance|mortgage)|loan\s*(?:is\s*)?(?:paid off|cleared|settled)|fully paid)\b/i.test(text);
  if (explicitNoLoan) updates.loan = "No";
  else if (loanYes) updates.loan = "Yes";
  else if (question === "loan" && /^no\b/i.test(text)) updates.loan = "No";
  if (question === "balance" || /\b(?:outstanding|balance|owe|loan|mortgage|finance)\b/i.test(text)) {
    const amount = text.match(/\b(\d[\d,]*(?:\.\d+)?)\s*(k|thousand)?\b/i);
    if (amount && !/\b(?:km|kms|model|year|fines)\b/i.test(text) && !(Number(amount[1]) >= 1980 && Number(amount[1]) <= 2035 && !amount[2])) updates.mortgage_amount = String(Number(amount[1].replace(/,/g, "")) * (amount[2] ? 1000 : 1));
  }
  if (/\b(?:asap|soon|sell|ready|not in.*hurry|in \d+ days|next month|this month|next week|good (?:price|offer))\b/i.test(text) && !LOCATION_REQUEST.test(text)) updates.sell_timeline = text;
  const dubaiLocalTime = new Date(now.getTime() + 4 * 3600000);
  const day = dubaiLocalTime.getUTCDay(), hour = dubaiLocalTime.getUTCHours();
  const open = day !== 0 && hour >= (day === 5 ? 12 : 10) && hour < 19;
  let nextDay = day, daysAhead = 0;
  if (day === 0 || hour >= 19) { nextDay = (day + 1) % 7; daysAhead = 1; }
  if (nextDay === 0) { nextDay = 1; daysAhead++; }
  const when = daysAhead === 0 ? "today" : daysAhead === 1 ? "tomorrow" : "Monday";
  const openAt = nextDay === 5 ? "12 PM" : "10 AM";
  const appointmentDay = (date: string) => {
    const d = new Date(date + "T12:00:00Z");
    const label = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][d.getUTCDay()];
    const currentWeek = Date.UTC(dubaiLocalTime.getUTCFullYear(),dubaiLocalTime.getUTCMonth(),dubaiLocalTime.getUTCDate()-((day+6)%7));
    const targetWeek = Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-((d.getUTCDay()+6)%7));
    if (targetWeek <= currentWeek + 7 * 86400e3) return label;
    const n=d.getUTCDate(), suffix=n%100>=11&&n%100<=13?"th":n%10===1?"st":n%10===2?"nd":n%10===3?"rd":"th";
    return "next week "+label+" "+n+suffix+" of "+d.toLocaleString("en-GB",{month:"long",timeZone:"UTC"});
  };
  const inspectionExplanation = "Before buying your car, we need a quick free inspection to verify its condition. If everything is in order and we agree on a price, we can buy it and pay cash the same day.";
  const requestedSellingDay = () => {
    const statements = [updates.sell_timeline, c.sell_timeline, ...(c.messages ?? []).filter(m => m.role === "user").map(m => m.content)].filter(Boolean) as string[];
    const weekdayNames = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
    for (const statement of statements) {
      const match = statement.match(/\b(?:sell|selling|sale|sold)\b.{0,90}?\b(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
      if (!match) continue;
      const wanted = weekdayNames.indexOf(match[1].toLowerCase());
      const offset = (wanted - day + 7) % 7 || 7;
      return { wanted, date: iso(new Date(+dubaiLocalTime + offset * 86400e3)) };
    }
    return null;
  };
  const arrival = () => {
    const requested = requestedSellingDay();
    if (requested && requested.wanted !== 0) {
      state.proposedDate = requested.date;
      return inspectionExplanation + " What time would you like to come on " + appointmentDay(requested.date) + "?";
    }
    const target = iso(new Date(+dubaiLocalTime + daysAhead * 86400e3));
    const sundayNotice = day === 0 || (day === 6 && daysAhead > 0) ? "We're closed on Sundays. " : "";
    const closedNotice = !open && !sundayNotice ? "We're currently closed. " : "";
    return sundayNotice + closedNotice + inspectionExplanation + " What time can you bring your car " + (daysAhead ? "on " + appointmentDay(target) : "today") + "?";
  };
  const followUp = () => (updates.sell_timeline || c.sell_timeline || state.askedFields?.sell) ? arrival() : "When are you planning to sell your car?";
  if (/tomorrow is sunday|tomorrow's sunday|sunday is closed|closed on sunday/i.test(text)) {
    state.proposedDate=undefined;state.proposedTime=undefined;state.customerAgreedSlot=false;
    const monday=iso(new Date(+dubaiLocalTime+(((8-day)%7)||7)*86400e3));
    return end("You're right, sorry about that. We're closed on Sunday. "+inspectionExplanation+" What time can you bring your car on "+appointmentDay(monday)+"?","time","visit_proposed");
  }
  if (/\b(?:not sure|don't know|cannot say|can't say) when i can (?:come|bring)/i.test(text)) return end(answer("No problem! Would you prefer that our team gives you a call tomorrow to arrange a convenient time?"), "callback", "collecting", "lead");
  if (/\b(home visit|visit my place|come to (?:me|my|sharjah)|inspection in sharjah|you can come|you come i bring)\b/i.test(text)) return end(answer("All our inspections take place at our branch in Al Quoz. It takes about 10–15 minutes, and if we agree on the price, we can buy your car and pay cash straight away. " + followUp()), "time", wasBooked ? "reconfirmation" : "collecting");
  if (/\b(?:call ?back|call me|arrange a call|call tomorrow|call on tomorrow|contact me tomorrow)\b/i.test(text)) {
    state.consent = "accepted"; note("Callback requested: " + text);
    return end(answer("Of course. Our purchasing team can call you on this WhatsApp number."), "", "team_accepted", "lead");
  }
  if (/\b(?:not in (?:a )?hurry|next month|in 30 days|(?:will|i'?ll) (?:check|update|inform)|let me (?:think|check)|i'?ll let you know|once i'?m free|when i'?m ready)\b/i.test(text)) return end(answer("No problem. When would you like to come for a free inspection?"), "time", "collecting");
  if (PRICE.test(text) && !/\b(free|charge|fee|commission)\b/i.test(text)) { state.priceRequests = (state.priceRequests ?? 0) + 1; return end(answer(`I understand that the price matters before you make the trip. The final offer follows the free 10–15 minute inspection, with no obligation to sell.${price ? " I've recorded your asking price for the team." : ""} ${state.priceRequests >= 2 ? CHOICE : followUp()}`), state.priceRequests >= 2 ? "choice" : "time", wasBooked ? state.status : "collecting"); }
  if (question === "callback" && !YES.test(text) && !dateFromText(text, now) && !timeFromText(text, true)) return end(answer("No problem. Contact us when you're ready, or let me know if you would like a personal call."), "callback");
  // Explicit travel-time statements are not arrival commitments.
  if ((/\b(leav(?:e|ing)|depart|before|after|between|onwards)\b/i.test(text) || /\d\s*(?:am|pm)?\s+(?:to|and)\s+\d/i.test(text)) && /\d/.test(text)) { state.proposedTime = undefined; const range = text.match(/(?:between\s*)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:to|and|[-–])\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/i); if (range) { const a = timeFromText(`${range[1]}:${range[2] ?? "00"}${range[3] || range[6] || ""}`, true), b = timeFromText(`${range[4]}:${range[5] ?? "00"}${range[6] || range[3] || ""}`, true); if (a && b) { state.timeMin = mins(a); state.timeMax = mins(b); } } const day = dateFromText(text, now); if (day) state.proposedDate = day; return end(answer(/leav|depart/i.test(text) ? "What time would you arrive at our branch? Our last inspection starts at 6:30 PM." : "What exact arrival time within that availability would you prefer?"), "exact_time", "visit_proposed"); }
  let date = dateFromText(text, now), time = timeFromText(text, ["time", "exact_time", "confirm"].includes(question));
  const dayPart = text.match(/\b(morning|afternoon|evening)\b/i)?.[1]?.toLowerCase() as FlowState["part"];
  if (dayPart) state.part = dayPart;
  if (date && state.proposedDate && date !== state.proposedDate) { state.proposedTime = undefined; state.customerAgreedSlot = false; state.timeMin = undefined; state.timeMax = undefined; }
  if (date && new Date(date + "T12:00:00Z").getUTCDay() === 0) {
    state.proposedDate = undefined; state.proposedTime = undefined; state.customerAgreedSlot = false;
    const monday = iso(new Date(Date.parse(date + "T12:00:00Z") + 86400e3));
    return end(answer("We're closed on Sundays. " + inspectionExplanation + " What time can you bring your car on " + appointmentDay(monday) + "?"), "time", "visit_proposed");
  }
  if (date) state.proposedDate = date;
  if (question === "confirm" && YES.test(text)) { date = state.proposedDate; time = state.proposedTime; }
  if (time) {
    if (!state.proposedDate) { const suggested = /tomorrow/i.test(previous) ? "tomorrow" : /today|this afternoon|this evening/i.test(previous) ? "today" : undefined; if (suggested) state.proposedDate = dateFromText(suggested, now); }
    if (state.proposedDate && !slotValid(state.proposedDate, time, now)) { state.proposedTime = undefined; return end(answer("That time is outside an available inspection slot. We open at 10 AM, or noon on Friday, close on Sunday, and take the last inspection at 6:30 PM. Which day and time would work?"), "time", "visit_proposed"); }
    if (Number(time.slice(3)) % 30 !== 0 && question !== "confirm") { const rounded = Math.ceil(mins(time) / 30) * 30, proposed = `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`; state.proposedTime = proposed; if (state.proposedDate && !slotValid(state.proposedDate, proposed, now)) return end(answer("That time would fall after our last inspection. Which other time would work?"), "time", "visit_proposed"); return end(answer(`Would ${proposed} on ${state.proposedDate || "your chosen day"} work instead? Please confirm before I book it.`), "confirm", "awaiting_confirmation"); }
    state.proposedTime = time;
    if (!state.proposedDate) return end(answer(`Which day would you like to arrive at ${time}?`), "day", "visit_proposed");
  }
  const hasIntent = !!time && !/\?|\b(maybe|perhaps|if|busy|cannot|can'?t)\b/i.test(text);
  if (hasIntent && state.proposedDate && state.proposedTime) state.customerAgreedSlot = true;
  const knownLoan = updates.loan || c.loan;
  // Missing vehicle/finance details must not prevent an explicitly agreed inspection.
  // Verified non-GCC cars are already intercepted above and cannot be booked.
  const essential = true;
  const financeReady = true;
  if (essential && financeReady && state.proposedDate && state.proposedTime && slotValid(state.proposedDate, state.proposedTime, now) && (hasIntent || !wasBooked && state.customerAgreedSlot || question === "name" && !!name && state.status === "awaiting_confirmation")) {
    if (!validName(name || c.name)) return end(answer("May I have your name for the booking?"), "name", "awaiting_confirmation");
    const bookedDate = new Date(state.proposedDate + "T12:00:00Z");
    const bookedDay = bookedDate.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
    const bookedMonth = bookedDate.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
    const bookedNumber = bookedDate.getUTCDate();
    const bookedSuffix = bookedNumber % 100 >= 11 && bookedNumber % 100 <= 13 ? "th" : bookedNumber % 10 === 1 ? "st" : bookedNumber % 10 === 2 ? "nd" : bookedNumber % 10 === 3 ? "rd" : "th";
    const [bookedHour, bookedMinute] = state.proposedTime.split(":").map(Number);
    const bookedTime = String(bookedHour % 12 || 12) + (bookedMinute ? ":" + String(bookedMinute).padStart(2, "0") : "") + " " + (bookedHour >= 12 ? "pm" : "am");
    const reply = answer(`You're booked for ${bookedDay} ${bookedNumber}${bookedSuffix} of ${bookedMonth} at ${bookedTime}. Our team will be in touch to confirm the details. Please bring your Emirates ID and Mulkiya.\\n\\n${LOCATION}`);
    const result = end(reply, "", "booked", wasBooked ? "change" : "booking"); result.confirm = true; result.updates.appointment_date = state.proposedDate; result.updates.appointment_time = state.proposedTime; return result;
  }
  if (essential && financeReady && state.proposedDate && !state.proposedTime) {
    if (new Date(`${state.proposedDate}T12:00:00Z`).getUTCDay() === 0) { state.proposedDate = undefined; return end(answer("We're closed on Sundays. Which other day would suit you?"), "time", "visit_proposed"); }
    if (question === "exact_time" && !prefix.length && (dayPart || /\b(anytime|any time|you choose)\b/i.test(text))) { const result = end("", "exact_time", "visit_proposed"); result.defaultDate = state.proposedDate; return result; }
    return end(answer(`What exact arrival time would you prefer on ${appointmentDay(state.proposedDate)}?${new Date(`${state.proposedDate}T12:00:00Z`).getUTCDay() === 5 ? " We open at noon on Friday." : ""}`), "exact_time", "visit_proposed");
  }
  if (wasBooked && !date && !time) return end(answer(prefix.length ? "Let us know if you need to change the visit." : "You're welcome. Let us know if you need anything else about the inspection."), state.question);
  if (/\[(photo|file|sent photos\/files)\]/i.test(text)) { if (!state.mediaExplained) { prefix.push("I can't read photos or files, but I can use any details you type here."); state.mediaExplained = true; } }
  // Booking-first: ask each optional field once, then move forward.
  // This is persisted with the conversation and does not reset on unrelated replies.
  const asked = state.askedFields ?? {};
  // Existing live chats may predate this tracker. Recover already-asked fields
  // from Kaya's prior messages so deployment does not restart questions.
  for (const message of c.messages ?? []) {
    if (message.role !== "assistant") continue;
    const spoken = message.content.toLowerCase();
    if (/may i know your name|what is your name|what's your name/.test(spoken)) asked.name = true;
    if (/what car|car's (?:make|model)|model and year|make and model/.test(spoken)) asked.vehicle = true;
    if (/what's the mileage|how many kilometres|mileage on the car/.test(spoken)) asked.mileage = true;
    if (/is it gcc specs|gcc specs, non-gcc/.test(spoken)) asked.specs = true;
    if (/outstanding loan|does the car have a loan/.test(spoken)) asked.loan = true;
    if (/outstanding balance|how much is left on the loan/.test(spoken)) asked.balance = true;
    if (/when are you planning to sell/.test(spoken)) asked.sell = true;
  }
  const askOnce = (key: string, reply: string): Turn | null => {
    if (asked[key]) return null;
    asked[key] = true;
    state.askedFields = asked;
    return end(answer([nameAcknowledgement, reply].filter(Boolean).join(" ")), key, "collecting");
  };
  // The customer can give facts in any order. Never restart the questionnaire.
  if (!validName(name || c.name) && !asked.name) return askOnce("name", "Hi! I’m Kaya from Mister Wheelz. May I know your name, please?")!;
  if (!vehicle.make && !asked.vehicle) return askOnce("vehicle", "Please let me know which car you’re selling (make, model and year).")!;
  if (vehicle.make && (!vehicle.model || !vehicle.year) && !asked.vehicle) return askOnce("vehicle", "What's the model and year?")!;
  if (!vehicle.mileage && !asked.mileage) return askOnce("mileage", "What's the mileage?")!;
  if (!vehicle.specs && !asked.specs) return askOnce("specs", "Is it GCC specs?")!;
  const loan = updates.loan || c.loan;
  if (Number(vehicle.year) >= 2020 && !/^(yes|no)$/i.test(loan ?? "") && !asked.loan) return askOnce("loan", "Does the car have a loan?")!;
  if (/^yes$/i.test(loan ?? "") && !(updates.mortgage_amount || c.mortgage_amount) && !asked.balance) return askOnce("balance", "How much is left on the loan?")!;
  const priorUrgency = (c.messages ?? []).some(m => m.role === "user" && /(?:leav(?:e|ing)|going back home|mov(?:e|ing) back|flying home|relocat(?:e|ing)|visa cancel).{0,140}(?:sell|car)|(?:sell|car).{0,140}(?:this wee[k|l]|urgent|asap|before (?:i|we) leave)/i.test(m.content));
  if (!(updates.sell_timeline || c.sell_timeline || priorUrgency || (c.messages ?? []).some(m => m.role === "user" && (urgentSalePattern.test(m.content) || explicitSaleDay.test(m.content)))) && !asked.sell) return askOnce("sell", "When are you planning to sell?")!;
  if (!state.proposedDate) return end(answer(arrival()), "time", "visit_proposed");
  return end(answer(`What time would you like to come on ${appointmentDay(state.proposedDate)}?`), "exact_time", "visit_proposed");
}
