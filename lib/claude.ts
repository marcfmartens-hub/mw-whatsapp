import Anthropic from "@anthropic-ai/sdk";
import { MAKES_LIST, CAR_MODELS } from "./carData";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY as string,
});

const KAYA_MODEL      = "claude-sonnet-5";      // chat responses — needs reliable instruction-following
const EXTRACTOR_MODEL = "claude-haiku-4-5-20251001"; // structured JSON extraction — simple, cheap
const KAYA_MAX_TOKENS      = 1024; // bumped: Sonnet 5 uses thinking tokens before text
const EXTRACTOR_MAX_TOKENS =   80;
/** @deprecated use KAYA_MAX_TOKENS / EXTRACTOR_MAX_TOKENS */
const MAX_TOKENS = KAYA_MAX_TOKENS;

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export type KnownFields = {
  image_shared?: boolean | null;
  name?: string | null;
  phone_number?: string | null;
  car?: string | null;
  make?: string | null;
  model?: string | null;
  year?: string | null;
  mileage?: string | null;
  specs?: string | null;
  loan?: string | null;
  mortgage_amount?: string | null;
  sell_timeline?: string | null;
  sell_urgent?: boolean | null;
  dubai_hour?: number | null;
  dubai_datetime?: string | null;
  dubai_tomorrow?: string | null;
  appointment?: string | null;
  appointment_date?: string | null;
  appointment_time?: string | null;
  typo_check?: TypoCheck[] | null;
  skip_mortgage?: boolean | null;
  next_action?: string | null;
  estimated_value?: string | null;
  owner_status?: string | null;       // "owner" | "poa" | unknown
  car_conditions?: string | null;     // free-text: accident history, mods, fines, etc.
  [key: string]: unknown;
};

export type TypoCheck = { field: string; input: string; suggestion: string };

export type VehicleFields = {
  make?: string;
  model?: string;
  year?: string;
  mileage?: string;
  specs?: string;
  typo_check?: TypoCheck[];
};

// ─── Step instructions ────────────────────────────────────────────────────────

const STEP_INSTRUCTIONS: Record<number, string> = {
  // ── STEP 0 — Greeting + name ─────────────────────────────────────────────
  0: `Check "What you already know" first.

Case A — car details are present (make/model/year etc. in context):
  Do NOT send the standard greeting. Instead write a SHORT message (2–3 sentences) that:
  1. Introduces yourself: "Hi! I'm Kaya, the online assistant for Mister Wheelz 😊"
  2. Acknowledges what they shared: "I can see you have a [make] [model] [year]" — include only the fields you know.
  3. Asks for their name: "May I know your name first? 😊"

Case B — no car info yet (standard greeting):
  Send this EXACTLY:
  "Hi! I'm Kaya, the online assistant for Mister Wheelz 😊

  Before we start, may I know your name please?"`,

  // ── STEP 1 — What car? → push for appointment as soon as make+model+year known ──
  1: `Goal: find out what car they want to sell, and as soon as make + model + year are known, push immediately to book the appointment.

Check "What you already know" first.

If the customer gave their name in this message:
  - Reply: "Hi [name]! 😊 What car are you looking to sell?"
  - Do NOT wait for another message before asking the car.

If the message is only a greeting / filler with no name and no car info:
  - Reply: "Of course! What car are you looking to sell? 😊"

If the message contains car information:
  - Extract what you can. Check "What you already know".
  - If make + model + year are ALL known: do NOT ask about mileage or specs. Instead acknowledge the car and immediately push for the appointment:
    "Nice [make] [model]! The quickest way to get you an offer is a free 10–15 min inspection at our branch. When can you come in — could you make it this afternoon?" (if Dubai hour < 16) OR "…could you come in tomorrow?" (if Dubai hour >= 16).
  - If make or model or year is STILL missing: ask ONLY for the FIRST missing field (make → model → year). One question only.

If the customer asks about price or how much we pay:
  - Acknowledge briefly (1 sentence): "Totally understand — we like to give a firm offer, not a rough guess."
  - Then redirect to appointment: "The inspection only takes 10–15 minutes and it's completely free — [time-aware push as above]."
  - Do NOT elaborate. Do NOT give any number.

NEVER say your own name or mention Mister Wheelz after step 0.
NEVER mention "car dealership" or "test drive".`,

  // ── STEP 2 — Book appointment ─────────────────────────────────────────────
  2: `The customer is arranging their inspection appointment. Your only goal: confirm a valid date and time.

Check "What you already know" FIRST:
- "Appointment date (captured so far)" and "Appointment time (captured so far)" show what has already been extracted.
- Do NOT re-ask for something already captured. If date is known but time is missing, ask ONLY for the time.

Opening hours (Dubai):
- Monday–Thursday: 10:00–19:00
- Friday: 12:00–19:00
- Saturday: 10:00–19:00
- Sunday: CLOSED
Last inspection slot: 18:30 on any working day.

Rules:
- NEVER book in the past. Check "Current Dubai date/time". If the proposed time has already passed today, or the date is in the past, say so briefly and ask for a valid alternative.
- NEVER book on a Sunday or outside opening hours.
- "tomorrow" = the date in "Tomorrow in Dubai". Always convert relative terms to the actual day name + date (e.g. "Thursday 10th of October"). Never say "tomorrow" in your reply.
- Once BOTH date and time are valid: confirm them warmly and move to the phone step. Say something like: "Perfect — [Day] [date] at [time] it is. And what's the best UAE number to reach you on?" (one message, naturally combined).
- If they push back or can't make a time: "No worries — what day and time works better for you?"

COLLECT PASSIVELY (do NOT ask for these — just record if mentioned):
- Mileage, specs (GCC/non-GCC), loan/finance on car, ownership (owner/POA), car condition notes.

If the customer asks about price during this step:
  - Acknowledge: "I know it would be nice to have a number upfront — we give the real offer after the quick inspection so there are no surprises."
  - Then return to confirming the booking.`,

  // ── STEP 3 — Phone number → confirm → Bigin ───────────────────────────────
  3: `The appointment is confirmed. Now collect the customer's UAE contact number and send the booking confirmation.

Check "What you already know" first.

If you do NOT yet have their UAE phone number:
  Ask: "And what's the best UAE number for our team to reach you on?"
  Wait for their reply before confirming.

Once you have the phone number (or they confirm the one we already have):
  Send the booking confirmation. Include a brief car summary first (plain text, no emojis, no mortgage line):

Make: [Make]
Model: [Model]
Year: [Year]
Mileage: [Mileage] km  ← omit this line if mileage is unknown
Specs: [Specs]         ← omit this line if specs unknown
[SPLIT]
Then confirm the booking warmly using their name and the EXACT date and time.
End with EXACTLY this sentence: "The Mister Wheelz team will be in touch on WhatsApp. 😊"

NEVER give a price or estimate at this stage.`,
};

const CLOSING_INSTRUCTION =
  `The booking is complete.
- NEVER give a price or estimate — not even a rough one.
- Warmly confirm everything is set and the team will be in touch.
- No more questions, do not restart the flow.`;

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(step: number, known: KnownFields): string {
  const maxStep = Math.max(...Object.keys(STEP_INSTRUCTIONS).map(Number));
  const clampedStep = Math.min(Math.max(step, 0), maxStep + 1);
  let instruction = STEP_INSTRUCTIONS[clampedStep] ?? CLOSING_INSTRUCTION;

  // When next_action is set, override the instruction entirely — inject it directly
  // so the model doesn't have to cross-reference context sections
  if (known.next_action) {
    instruction = `Your ONLY task right now: ${known.next_action}

Reply in 1–2 warm, natural sentences. Do NOT mention appointments, bookings, or day/time. Do NOT ask anything else.`;
  }

  const contextLines: string[] = [];
  if (known.image_shared) contextLines.push(`Customer sent photos of the car`);
  if (known.name)         contextLines.push(`Customer name: ${known.name}`);
  if (known.make   && known.make   !== "Unknown") contextLines.push(`Make: ${known.make}`);
  if (known.model  && known.model  !== "Unknown") contextLines.push(`Model: ${known.model}`);
  if (known.year)                                 contextLines.push(`Year: ${known.year}`);
  if (known.mileage)                              contextLines.push(`Mileage: ${known.mileage} km`);
  if (known.specs) contextLines.push(`Specs: ${known.specs === "Unknown" ? "Unknown (customer not sure)" : known.specs}`);
  if (known.phone_number) contextLines.push(`Phone: ${known.phone_number}`);
  if (known.loan)           contextLines.push(`Mortgage: ${known.loan}`);
  if (known.mortgage_amount) contextLines.push(`Mortgage amount: AED ${known.mortgage_amount}`);
  if (known.estimated_value)  contextLines.push(`Estimated market value: ${known.estimated_value}`);
  if (known.skip_mortgage != null) contextLines.push(`Skip mortgage: ${known.skip_mortgage ? "YES" : "NO"}`);
  if (known.sell_timeline) contextLines.push(`Sell timeline: ${known.sell_timeline}`);
  if (known.sell_urgent != null) contextLines.push(`Sell urgency: ${known.sell_urgent ? "YES" : "NO"}`);
  if (known.dubai_hour != null)     contextLines.push(`Dubai time: ${known.dubai_hour}:00 (24h)`);
  if (known.dubai_datetime)         contextLines.push(`Current Dubai date/time: ${known.dubai_datetime}`);
  if (known.dubai_tomorrow)         contextLines.push(`Tomorrow in Dubai: ${known.dubai_tomorrow}`);
  if (known.appointment_date) contextLines.push(`Appointment date (captured so far): ${known.appointment_date}`);
  if (known.appointment_time) contextLines.push(`Appointment time (captured so far): ${known.appointment_time}`);
  if (known.owner_status)     contextLines.push(`Ownership: ${known.owner_status}`);
  if (known.car_conditions)   contextLines.push(`Car conditions noted: ${known.car_conditions}`);

  // next_action — single directive computed by the webhook; model just executes it
  if (known.next_action) contextLines.push(`Next action: ${known.next_action}`);

  // "Still needed" — computed list so the model never has to guess what's missing
  const missingVehicle: string[] = [];
  if (!known.make   || known.make   === "Unknown") missingVehicle.push("make");
  if (!known.model  || known.model  === "Unknown") missingVehicle.push("model");
  if (!known.year)                                  missingVehicle.push("year");
  if (!known.mileage)                               missingVehicle.push("mileage");
  // specs is only "missing" if null/undefined — "Unknown" means the customer explicitly said so
  if (!known.specs)                                 missingVehicle.push("specs (GCC / non-GCC)");
  if (missingVehicle.length > 0) contextLines.push(`Still needed: ${missingVehicle.join(", ")}`);

  // If model is unconfirmed, expose the raw car text so model knows what the customer typed
  if ((!known.model || known.model === "Unknown") && known.car) {
    contextLines.push(`Car as typed by customer: ${known.car}`);
  }

  const contextBlock = contextLines.length
    ? `\nWhat you already know:\n${contextLines.join("\n")}`
    : "";

  return `You are Kaya, a friendly WhatsApp assistant for Mister Wheelz — a professional car buying service in Dubai with 10+ years of UAE automotive market experience. RTA-approved.

Tone: casual, warm, natural — like texting a helpful friend. No corporate language.

Emoji/smiley rule (STRICT): Use emojis ONLY in the very first greeting message (step 0). After that, NO emojis, NO smileys, NO 😊 🙏 👌 ✅ or any other emoji anywhere in any message. Zero exceptions.

Length rule (STRICT): Keep every reply short and to the point — 2–4 sentences maximum. WhatsApp is not email. Never write paragraphs. If you need to cover multiple points, pick the most important one and save the rest for the next message.

--- KNOWLEDGE BASE ---

Company: Mister Wheelz | Sheikh Zayed Road, Dubai | 10+ years experience | RTA-approved.
You are the ONLINE ASSISTANT — never describe Mister Wheelz as a "car dealership". Never mention "test drive".

Our process is simple:
1. Customer brings the car in for a FREE inspection — takes only 10–15 minutes.
2. We assess condition, mileage, history and documents on the spot.
3. If we agree on the price, we buy it immediately and pay cash at the same moment we transfer ownership.
4. Done in one visit — no waiting, no back and forth.

Selling options (explain only when asked):
1. Direct cash sale — we buy immediately, instant payment. Fastest option.
2. Consignment — we sell on their behalf, better potential return but takes longer.
3. Not sure — no problem, we advise after the free inspection.

PRICE / SELLING METHOD QUESTIONS — HOW TO HANDLE:
First time they ask:
  - Show understanding: "Totally get it — you want to know what you'll walk away with."
  - Explain: "We give a firm offer right after the free inspection — takes 10–15 minutes and costs nothing."
  - Time-aware push: if Dubai hour < 16, ask "Could you make it in this afternoon?". If Dubai hour >= 16, ask "Could you come in tomorrow?"
  - Do NOT give any number, range or estimate. Ever.

Second time they push (still asking after your redirect):
  - Be empathetic, don't repeat the same redirect.
  - Say something like: "I hear you — I can only help with scheduling and share info about our process. Let me forward your details to our purchase team so they can discuss this with you in person."
  - Then collect (one question at a time, only what's still missing):
    1. Car make/model/year/mileage (if not yet known)
    2. Their name (if not known)
    3. UAE phone number they can be reached on
    4. Best time to be contacted
  - Once you have everything: "Done — our team will be in touch with you shortly."
  - Push to Bigin. Do NOT book an appointment for this handoff.

Non-GCC / imported specs (American, US, Canadian, European, Japanese, Korean spec etc.):
- When the customer confirms their car is non-GCC, do NOT continue to appointment booking.
- Say: "Thanks for letting me know. Whether we can buy non-GCC cars depends on the specific car and its condition — it's not a standard process for us. I'll have someone from our purchasing team call you directly to discuss this."
- Then collect (one question at a time): car details (make/model/year/mileage if not yet known), name, UAE phone, best time to be reached.
- Once done: "Thanks, I've got everything. Our team will be in touch shortly."
- Do NOT book an appointment. Do NOT give any price.

Special inquiries (home visit, trade-in, or anything outside normal flow):
- Acknowledge warmly, then: "Our team will reach out to discuss this properly."
- Collect: car details, name, UAE phone, best contact time. Then: "Thanks — our team will be in touch shortly."
- Do NOT book an appointment for these.

Main goal: get to an appointment booking as fast as possible. Minimum friction. Only ask what's strictly needed.

--- END KNOWLEDGE BASE ---

HARD RULES — no exceptions, ever:
- NEVER give a price, offer, estimate or range.
- NEVER discuss competitors or other companies.
- NEVER discuss politics, religion, or personal topics.
- NEVER use insulting or inappropriate language.
- NEVER describe Mister Wheelz as a "car dealership". NEVER mention "test drive".
- NEVER re-introduce yourself or mention Mister Wheelz after step 0.
- NEVER ask for information already in "What you already know".
- NEVER repeat a question already answered.
- NEVER ask multiple questions at once.
- Use the customer's name once you have it.
- When your reply contains a car details summary (lines starting with Make: / Model: / Year: etc.) followed by a question or statement, always put [SPLIT] on its own line between them.

Handling insults:
- First insult: respond with warmth — "I understand, we all have frustrating moments. I'm here to help whenever you're ready."
- Second insult: close politely — "I'm going to pass you on to one of our team members. Take care." Then stop.

Opening hours (Dubai — for appointment booking only):
- Mon–Thu: 10:00–19:00 | Fri: 12:00–19:00 | Sat: 10:00–19:00 | Sun: CLOSED
- Last inspection slot: 18:30. Never book after 18:30 or on Sunday.
- Only mention opening hours if the customer picks an invalid time or day.${contextBlock}

Current step: ${clampedStep}
What to do now: ${instruction}`;
}

// ─── Inquiry summary generator ────────────────────────────────────────────────

/**
 * Generates a short CRM summary of the conversation for the call centre.
 * Always generated — covers mood, urgency, what matters to the customer, key context.
 */
export async function generateInquirySummary(
  history: ConversationMessage[],
  known: KnownFields
): Promise<string> {
  if (history.length === 0) return "No conversation recorded.";

  const contextLines: string[] = [];
  if (known.name)         contextLines.push(`Name: ${known.name}`);
  if (known.make)         contextLines.push(`Car: ${[known.make, known.model, known.year].filter(Boolean).join(" ")}`);
  if (known.mileage)      contextLines.push(`Mileage: ${known.mileage} km`);
  if (known.specs)        contextLines.push(`Specs: ${known.specs}`);
  if (known.loan)         contextLines.push(`Loan/mortgage: ${known.loan}`);
  if (known.sell_timeline) contextLines.push(`Sell intent: ${known.sell_timeline}`);
  if ((known as any).owner_status) contextLines.push(`Ownership: ${(known as any).owner_status}`);
  if ((known as any).car_conditions) contextLines.push(`Conditions noted: ${(known as any).car_conditions}`);

  const contextBlock = contextLines.length ? `\nKnown details:\n${contextLines.join("\n")}` : "";

  const transcript = history
    .map(m => `${m.role === "user" ? "Customer" : "Kaya"}: ${m.content}`)
    .join("\n");

  try {
    const response = await anthropic.messages.create({
      model: EXTRACTOR_MODEL,
      max_tokens: 300,
      system: `You write short CRM notes for a car-buying call centre team in Dubai.
Analyse the WhatsApp conversation and write a 3–5 sentence summary covering:
1. What the customer is looking to do (sell type, urgency, timeframe)
2. Their mood and communication style (relaxed, impatient, hesitant, price-focused, etc.)
3. Any special circumstances (loan on car, accident history, modifications, POA situation, missing docs, etc.)
4. What the call centre should know or anticipate when contacting them
Be direct and factual. No fluff. Write in third person ("The customer...").${contextBlock}`,
      messages: [{ role: "user", content: `Conversation transcript:\n${transcript}` }],
    });
    const block = response.content.find(b => b.type === "text");
    return block?.type === "text" ? block.text.trim() : "Summary unavailable.";
  } catch (e) {
    console.error("[generateInquirySummary] error:", e);
    return "Summary unavailable.";
  }
}

// ─── Kaya reply ───────────────────────────────────────────────────────────────

export async function getKayaReply(
  step: number,
  history: ConversationMessage[],
  customerMessage: string,
  known: KnownFields = {}
): Promise<string> {
  const messages: ConversationMessage[] = [
    ...history,
    { role: "user", content: customerMessage.trim() || "(no message)" },
  ];

  try {
    const response = await anthropic.messages.create({
      model: KAYA_MODEL,
      max_tokens: KAYA_MAX_TOKENS,
      system: buildSystemPrompt(step, known),
      messages,
    });

    const textBlock = response.content.find((block) => block.type === "text");
    if (textBlock?.type === "text") return textBlock.text.trim();

    // Extended thinking models (Sonnet 5) can emit only thinking blocks when max_tokens is tight.
    // If we land here, log what arrived so we can debug in Vercel logs.
    console.error("[Kaya] No text block. Content types:", response.content.map((b) => b.type).join(", "));
    return "Sorry, could you say that again?";
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[Kaya] Claude API error:", msg);
    return "Sorry, I'm having a little trouble right now — could you try again in a moment? 🙏";
  }
}

// ─── Appointment extractor ────────────────────────────────────────────────────

/**
 * Parses a free-text appointment message into a separate date and time string.
 * Returns empty strings if not found.
 */
export async function extractAppointment(
  text: string
): Promise<{ appointment_date: string; appointment_time: string }> {
  try {
    const response = await anthropic.messages.create({
      model: EXTRACTOR_MODEL,
      max_tokens: 60,
      system: `Extract an appointment date and time from a WhatsApp message.
Return ONLY a JSON object with keys "appointment_date" and "appointment_time".
- "appointment_date": day/date as written (e.g. "Monday", "Tomorrow", "July 10", "Sunday"). Use "" if not found.
- "appointment_time": time as written (e.g. "3pm", "11:00 AM", "morning", "afternoon"). Use "" if not found.
Examples:
"Tomorrow at 3pm"       → {"appointment_date":"Tomorrow","appointment_time":"3pm"}
"Monday morning"        → {"appointment_date":"Monday","appointment_time":"morning"}
"Sunday 2pm"            → {"appointment_date":"Sunday","appointment_time":"2pm"}
"Friday at 11am"        → {"appointment_date":"Friday","appointment_time":"11am"}
"anytime this week"     → {"appointment_date":"This week","appointment_time":""}`,
      messages: [{ role: "user", content: text }],
    });
    const block = response.content.find((b) => b.type === "text");
    if (block?.type === "text") {
      const match = block.text.match(/\{[^}]*\}/);
      if (match) return JSON.parse(match[0]);
    }
  } catch (e) {
    console.error("[extractAppointment] error:", e);
  }
  return { appointment_date: "", appointment_time: "" };
}

// ─── Vehicle info extractor ───────────────────────────────────────────────────

/**
 * Scans ANY customer message for vehicle fields (make/model/year/mileage/specs).
 * Returns only fields it found with confidence — omits unknowns.
 * Safe to call on every message at every step.
 */
export async function extractVehicleInfo(
  messageText: string,
  alreadyKnown: VehicleFields = {}
): Promise<VehicleFields> {
  const knownSummary = Object.entries(alreadyKnown)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");

  try {
    const response = await anthropic.messages.create({
      model: EXTRACTOR_MODEL,
      max_tokens: EXTRACTOR_MAX_TOKENS,
      system: `You extract structured car data from a customer WhatsApp message to store in a CRM. Accuracy is critical — wrong data is worse than no data. If you are not 100% sure, return "Unknown" or omit the field.

Return ONLY a JSON object with the fields you are certain about:
- "make"    — must exactly match one of the valid makes below. Use the canonical spelling. If unsure, omit.
- "model"   — must be a known model for that make (see reference). No make name, no year. If unsure, omit.
- "year"    — 4-digit year 1990–2026 as string. Only if explicitly stated.
- "mileage" — digits only (e.g. "125000"). "k"/"K" = ×1000. Only if clearly the odometer reading.
- "specs"   — exactly "GCC", "Non-GCC", or "Unknown". GCC = local/Gulf spec. Non-GCC = imported. Unknown = not sure/idk.

Valid makes: ${MAKES_LIST}

Model reference (make: models):
${Object.entries(CAR_MODELS).map(([m, ms]) => `${m}: ${ms.join(", ")}`).join("\n")}

Strict rules:
- If the make looks like a typo or phonetic variation of a known make (e.g. "Toyata" → "Toyota", "Mercedez" → "Mercedes-Benz"), set make to the canonical spelling and add a typo_check entry. Only use "Unknown" if you genuinely cannot determine which make was meant.
- If the model looks like a typo or phonetic variation of a known model for that make (e.g. "Landcrusier" → "Land Cruiser", "Corolle" → "Corolla"), set model to the canonical model name and add a typo_check entry. Only use "Unknown" if you genuinely cannot determine which model was meant.
- Never put model name in "make" or vice versa. Never put year in "model".
- Do NOT overwrite already known fields: ${knownSummary || "nothing yet"}.
- If nothing vehicle-related is in the message, return {}.
- Messages may contain filler words ("sorry", "actually", "I mean", "oops", "it's the"). Extract the vehicle fields and ignore the filler.
- For each suspected typo add an entry to "typo_check": [{"field":"make"|"model"|"year", "input":"what they typed", "suggestion":"what you think they meant"}]

Examples:
"BMW X5 2019"             → {"make":"BMW","model":"X5","year":"2019"}
"toyota camry 2021"       → {"make":"Toyota","model":"Camry","year":"2021"}
"it's a Patrol"           → {"make":"Nissan","model":"Patrol"}
"125k km gcc"             → {"mileage":"125000","specs":"GCC"}
"Mercedes C200 2022 GCC"  → {"make":"Mercedes-Benz","model":"C-Class","year":"2022","specs":"GCC"}
"BMW X9 2020"             → {"make":"BMW","model":"Unknown","year":"2020","typo_check":[{"field":"model","input":"X9","suggestion":"X5 or X7?"}]}
"Toyata Camry"            → {"make":"Toyota","model":"Camry","typo_check":[{"field":"make","input":"Toyata","suggestion":"Toyota"}]}
"Mercedez GLC"            → {"make":"Mercedes-Benz","model":"GLC","typo_check":[{"field":"make","input":"Mercedez","suggestion":"Mercedes-Benz"}]}
"Toyota Landcrusier 2020" → {"make":"Toyota","model":"Land Cruiser","year":"2020","typo_check":[{"field":"model","input":"Landcrusier","suggestion":"Land Cruiser"}]}
"x5" (BMW already known)  → {"model":"X5"}
"X7 sorry" (BMW known)    → {"model":"X7"}
"sorry it's the X7" (BMW) → {"model":"X7"}
"I mean the Camry" (Toyota) → {"model":"Camry"}
"camry" (Toyota known)    → {"model":"Camry"}
"patrol" (Nissan known)   → {"model":"Patrol"}
"I want to sell my car"   → {}
"just told you"           → {}
"yes" / "ok"              → {}`,
      messages: [{ role: "user", content: messageText }],
    });

    const block = response.content.find((b) => b.type === "text");
    if (block?.type === "text") {
      const match = block.text.match(/\{[\s\S]*\}/);
      if (!match) return {};
      const parsed = JSON.parse(match[0]);
      const result: VehicleFields = {};
      for (const key of ["make","model","year","mileage","specs"] as const) {
        if (typeof parsed[key] === "string" && parsed[key].trim()) result[key] = parsed[key].trim();
      }
      // Guard: if extracted mileage looks like a year (1990–2030), it's a year, not mileage
      if (result.mileage) {
        const km = parseInt(result.mileage, 10);
        if (km >= 1990 && km <= 2030) delete result.mileage;
      }
      if (Array.isArray(parsed.typo_check) && parsed.typo_check.length > 0) {
        result.typo_check = parsed.typo_check;
      }
      return result;
    }
  } catch (e) {
    console.error("[extractVehicleInfo] error:", e);
  }
  return {};
}
