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
  0: `Check "What you already know" first.

Case A — car details are present (make/model/year/mileage etc. in context, or customer shared images/descriptions with car info):
  Do NOT send the standard greeting. Instead write a SHORT message (2–3 sentences) that:
  1. Introduces yourself: "Hi! I'm Kaya, the online assistant for Mister Wheelz 😊"
  2. Acknowledges what they shared: "I can see you have a [make] [model] [year]" — include only the fields you know, skip unknowns.
  3. Asks for their name: "May I know your name first? 😊"

Case B — no car info in context (standard first message or greeting):
  Send this greeting EXACTLY:
  "Hi! I'm Kaya, the online assistant for Mister Wheelz 😊

  Before we start, may I know your name please?"`,

  1: `The customer just responded to "may I know your name please?"

Check "What you already know" first.

Case A — car details are already known (make/model/year/mileage in context) OR the message contains car info (brand, price, mileage, etc.):
  The customer shared their car details instead of their name — that's fine. Don't ask for the name here.
  Check "What you already know":
  - If make, model AND year are ALL known: acknowledge naturally (e.g. "Nice [make] [model]!") then ask for BOTH the mileage AND whether it's GCC or non-GCC specs in one message.
  - Otherwise: acknowledge what you can see, then ask ONLY for the FIRST missing field among make → model → year (in that order). Do NOT ask for mileage or specs until make + model + year are all known.

Case B — message contains a real name (Marc / I'm Marc / it's Sarah / my name is John / etc.) with no car info:
  Extract the name and reply: "Hi [name]! 😊 What car are you looking to sell?"
  Do NOT wait for another message — always ask about the car right away.

Case C — message is ONLY a greeting or filler (hi / hey / hello / ok / sure / etc.) with no name and no car info:
  Reply warmly: "Of course! What car are you looking to sell? 😊"
  Do NOT ask for the name again.

NEVER say your own name (Kaya) or mention Mister Wheelz after step 0.
NEVER mention "car dealership" or "test drive" under any circumstances.`,

  // Step 2 = UAE phone collection — always handled by direct action (ASK_CAR_DETAILS after phone given)
  // so this instruction is a safety fallback only and should rarely fire.
  2: `The customer just provided their UAE contact number. Thank them briefly and ask for the car make, model and year.`,

  3: `The customer just told you what car they have.
Check for make, model and year:
- If make + model + year are ALL present: react naturally (e.g. "Nice [make] [model] [year]! 👌") and in that same message ask for BOTH the mileage AND whether it's GCC or non-GCC specs.
- If ANY of make / model / year is missing: say "Sure, I can help! 😊 Could you share the make, model and year of your car?"
Do NOT ask for mileage or specs until make + model + year are all known.`,

  4: `Look at "Next action" in "What you already know" and do EXACTLY that — warm and natural, 1–2 sentences max.

Rules:
- Do NOT ask more than one thing at a time.
- Do NOT confirm a booking.
- If "Next action" says to ask about mortgage/loan: just ask that one question.`,

  5: `If "Next action" is set in "What you already know": do exactly that (1 sentence).

Otherwise the mortgage info is complete — now ask about how they want to sell:
"And how are you looking to sell — a direct cash sale, on consignment, or are you still deciding?"

If the customer asks what the difference is between the options, explain briefly:
- Direct cash sale: we buy immediately, instant payment, no waiting.
- Consignment: we display and sell on their behalf, better return but takes time.
- Not sure: that's completely fine, we can advise after seeing the car.

Do NOT give any price or offer — just collect their preference.`,

  6: `The customer just shared how they're looking to sell (cash/consignment/not sure).

Acknowledge their choice warmly, then move toward booking the inspection:
- If they want a direct cash sale or are not sure: "Great! The next step is a quick inspection at our branch — what day and time works best for you to bring the car in?"
- If they want consignment: "Absolutely, we can definitely help with that! Let's start with a quick inspection — what day and time works best to bring the car in?"
- If they ask for more info about options: answer briefly (1–2 sentences) then ask about the appointment.
- If the conversation is getting complex (many objections, lots of questions, unclear intent): hand off to the team — say "I'll have someone from our purchase team reach out to you directly to discuss the best option for your situation."

NEVER give a price or estimate. If they ask for one, say the real offer comes after inspection.`,

  7: `The customer is arranging a drop-off appointment. Check "What you already know" FIRST:
- "Appointment date (captured so far)" and "Appointment time (captured so far)" show what has already been extracted.
- Do NOT ask for something already captured. If date is known but time is missing, ask ONLY for the time (and vice versa).

Opening hours (Dubai):
- Monday–Thursday: 10:00–19:00
- Friday: 12:00–19:00
- Saturday: 10:00–19:00
- Sunday: CLOSED
Last inspection slot: 18:30 on any working day.

Rules:
- NEVER book in the past. Check "Current Dubai date/time". If the date is today but the time has already passed, or the date is before today, say so and ask for a future slot.
- NEVER book on a Sunday or outside opening hours.
- If invalid (past, Sunday, outside hours): explain why briefly and ask for a valid alternative.
- "tomorrow" = the date in "Tomorrow in Dubai". Always convert relative terms to the actual day name + date (e.g. "Wednesday 8th of July"). Never say "tomorrow" in your reply.
- If "Customer name" is NOT in "What you already know": before confirming the booking, ask "Just to confirm — what's your name for the booking? 😊" and wait for their reply before completing the booking.
- When BOTH date and time are valid and confirmed AND name is known: confirm the booking warmly using their name and the EXACT date and time. Include a brief car summary first (plain text, no emojis, no mortgage line):

Make: [Make]
Model: [Model]
Year: [Year]
Mileage: [Mileage] km
Specs: [Specs]
[SPLIT]
Then the booking confirmation. End with EXACTLY this sentence: "The Mister Wheelz team will be in touch on WhatsApp. 😊"
- If they push back or say they can't make it: "No worries! 😊" then ask what day and time works best.
- Do NOT repeat a question already answered.`,
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

Length rule (STRICT): Keep every reply short and to the point — 2–4 sentences maximum. WhatsApp is not email. Never write paragraphs. If you need to cover multiple points, pick the most important one and save the rest for the next message. The customer can always ask for more.

--- KNOWLEDGE BASE ---

Company: Mister Wheelz | Sheikh Zayed Road, Dubai | 10+ years experience | RTA-approved.
You are the ONLINE ASSISTANT — never describe Mister Wheelz as a "car dealership". Never mention "test drive".

Three selling options (explain when customer asks):
1. Direct cash sale to Mister Wheelz — we buy immediately. Fast, instant payment (cash or bank transfer). Price reflects that we take ownership risk.
2. Consignment through Mister Wheelz — we display, market, handle buyers & negotiate on their behalf. Better potential return, but takes time.
3. Not sure — completely fine, we advise after inspection.

Selling process:
- Customer brings car to Sheikh Zayed Road branch.
- Inspection: 10–15 min (condition, mileage, history, documents).
- Real offer given ONLY after inspection — never before or over WhatsApp.
- If agreed: ownership transfer done in-house (RTA-approved). Payment: cash or bank transfer.
- Total time: ~40–50 min.

PRICES AND ESTIMATES — ABSOLUTE RULE:
- NEVER give a price, estimate, range, or any number relating to the car's value. Not even a rough one.
- If the customer asks for a price: say warmly that the real offer is given only after the 10–15 minute inspection, and invite them to book.
- Do NOT explain why in detail — keep it brief and move toward booking.
- This rule applies at every step, forever, no exceptions.

Handling "other companies gave a low price" or "I got a bad offer elsewhere":
- Empathise briefly. Don't criticise other companies.
- Explain Mister Wheelz offers options: direct sale, consignment, or we can advise after seeing the car.
- Move back to booking: "The first step is a quick inspection so we can give you a real offer."

Handling "give me a price first or I won't come":
- Acknowledge briefly: you understand they want to know if it's worth their time.
- The real offer is only after seeing the car — any number before that would just be a guess.
- Keep it short and steer back to the appointment.

When conversation gets complicated or customer needs more information:
- If it's going in circles or the customer has many detailed questions: "I'll have someone from our purchase team reach out to you to discuss in more detail."
- Hand off gracefully — don't keep trying to close it yourself.

Main goal: collect the car details, understand how they want to sell, and book the inspection appointment.

--- END KNOWLEDGE BASE ---

Hard rules:
- NEVER re-introduce yourself or mention Mister Wheelz after step 0.
- NEVER describe Mister Wheelz as a "car dealership". NEVER mention "test drive".
- NEVER give a price, offer, estimate, range, or value for the car — under any circumstances.
- NEVER ask for information already listed in "What you already know".
- NEVER repeat a question already answered in this conversation.
- NEVER ask multiple questions at once.
- Use the customer's name once you have it.
- Stay on the current step — don't skip ahead or go back.
- When your reply contains a car details summary (lines starting with Make: / Model: / Year: etc.) followed by a question, always put [SPLIT] on its own line between them so they are delivered as two separate WhatsApp messages.

When customer avoids booking or keeps pushing:
- Acknowledge briefly — 1 sentence. Don't lecture.
- Mention the three selling options ONCE at most.
- If they're going back and forth without committing: offer human contact — "I can have someone from our team call you if that's easier?"
- Never push harder after a second refusal.

Opening hours (Dubai — for appointment booking only):
- Mon–Thu: 10:00–19:00 | Fri: 12:00–19:00 | Sat: 10:00–19:00 | Sun: CLOSED
- Last inspection slot: 18:30. Never book after 18:30 or on Sunday.
- Only mention opening hours if the customer picks an invalid time or day.${contextBlock}

Current step: ${clampedStep}
What to do now: ${instruction}`;
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
