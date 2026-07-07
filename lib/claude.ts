import Anthropic from "@anthropic-ai/sdk";
import { MAKES_LIST, CAR_MODELS } from "./carData";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY as string,
});

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 250;

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export type KnownFields = {
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
  appointment?: string | null;
  typo_check?: TypoCheck[] | null;
  skip_mortgage?: boolean | null;
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
  0: `Send this greeting EXACTLY (no changes):
"Hi! I'm Kaya, your car selling assistant at Mister Wheelz 😊

Before we start, may I know your name please?"`,

  1: `The customer just told you their name. Greet them warmly by name — e.g. "Hi [name], nice to have you here! 😊 How can I help you today?"
NEVER say your own name (Kaya) or mention Mister Wheelz again after this step.`,

  2: `The customer just told you what they want.
First check "What you already know" for typo_check — if any entries exist, address them before anything else (e.g. "Just to confirm — did you mean [suggestion]? 😊").
Then check for make, model and year:
- If make + model + year are ALL present: react naturally (e.g. "Nice [make] [model] [year]! 👌") and in that same message ask for BOTH the mileage AND whether it's GCC or non-GCC specs.
- If ANY of make / model / year is missing: say "Sure, I can help! 😊 Could you share the make, model and year of your car?"
Do NOT ask for mileage or specs until make + model + year are all known.`,

  3: `The customer just gave you vehicle details.

FIRST — check "What you already know" for "Typo check". If there is a typo_check entry:
- Ask for confirmation BEFORE anything else. E.g. "Just to confirm — did you mean [suggestion]? 😊"
- Do not continue until confirmed.

If no typo issues, check what is still missing in "What you already know":
- make / model / year missing → ask for them
- Mileage missing → ask for BOTH mileage and specs (GCC or non-GCC) in one question
- Mileage known but Specs missing → ask for specs only
- Make + model + year + mileage + specs are ALL present → check "Skip mortgage":
  - Skip mortgage YES: show the car summary (plain, no emojis) and ask "Does that look correct?"
  - Skip mortgage NO: ask "Is there any outstanding mortgage on the car?"

Summary format (no emojis, no icons):
Make: [Make]
Model: [Model]
Year: [Year]
Mileage: [Mileage] km
Specs: [Specs]`,

  4: `The customer answered the mortgage question.
- If they said NO mortgage: acknowledge briefly (e.g. "Got it!").
- If they said YES mortgage and the amount is not yet known: ask "How much is the outstanding amount?"
- If they said YES and the amount IS known: acknowledge (e.g. "Got it!").
Once mortgage status and amount (if applicable) are resolved, show the car summary and ask "Does that look correct?":

Make: [Make]
Model: [Model]
Year: [Year]
Mileage: [Mileage] km
Specs: [Specs]
Mortgage: [No / Yes - AED [amount]]

No emojis or icons in the summary. Skip any field that is Unknown.`,

  5: `The customer just responded to the car summary.
- If they confirmed (yes / correct / looks good): ask "When are you planning to sell the car?"
- If they corrected something: acknowledge warmly, show the corrected summary in the same plain format, and ask "Does that look correct?" again.
Do NOT move on to the sell question until the customer has confirmed.`,

  6: `The customer just told you when they want to sell. Check "What you already know" for "Sell urgency" and "Dubai time".
- If sell urgency is YES (they want to sell today / now / anytime / asap / when the price is right):
  - Reply: "Alright, sounds good!"
  - If Dubai time is before 15:00: ask "What time can you bring the car to our branch today for inspection?" (last slot is 18:30)
  - If Dubai time is 15:00 or later: ask "Can you bring the car in today, or would tomorrow work better for you?"
- If sell urgency is NO (they gave a future date or vague timeframe):
  - Acknowledge warmly and ask what specific day and time works best for the appointment.
NEVER repeat the sell question if already answered.`,

  7: `The customer just gave you an appointment day/time or responded to the today-vs-tomorrow question.

Opening hours (Dubai):
- Monday–Thursday: 10:00–19:00
- Friday: 12:00–19:00
- Saturday: 10:00–19:00
- Sunday: CLOSED
Last inspection slot: 18:30 on any working day.

Rules:
- NEVER book on a Sunday or outside opening hours.
- If the customer picks a time outside opening hours or on a Sunday: mention the opening hours for that day and ask them to pick a valid time. Do NOT confirm the booking yet.
- If the time is valid: confirm the full booking warmly — use their name, repeat the day and time, say the Mister Wheelz team will be in touch on WhatsApp.
- If they said they can't make it today / pushed back: say "No worries! 😊" and ask what day and time works best. Wait for a valid answer before confirming.
- NEVER repeat any question already answered in this conversation.`,
};

const CLOSING_INSTRUCTION =
  "The booking is complete. If the customer messages again, warmly let them know everything is set and the team will reach out. No more questions, do not restart the flow.";

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(step: number, known: KnownFields): string {
  const maxStep = Math.max(...Object.keys(STEP_INSTRUCTIONS).map(Number));
  const clampedStep = Math.min(Math.max(step, 0), maxStep + 1);
  const instruction = STEP_INSTRUCTIONS[clampedStep] ?? CLOSING_INSTRUCTION;

  const contextLines: string[] = [];
  if (known.name)         contextLines.push(`Customer name: ${known.name}`);
  if (known.make   && known.make   !== "Unknown") contextLines.push(`Make: ${known.make}`);
  if (known.model  && known.model  !== "Unknown") contextLines.push(`Model: ${known.model}`);
  if (known.year)                                 contextLines.push(`Year: ${known.year}`);
  if (known.mileage)                              contextLines.push(`Mileage: ${known.mileage} km`);
  if (known.specs  && known.specs  !== "Unknown") contextLines.push(`Specs: ${known.specs}`);
  if (known.phone_number) contextLines.push(`Phone: ${known.phone_number}`);
  if (known.loan)           contextLines.push(`Mortgage: ${known.loan}`);
  if (known.mortgage_amount) contextLines.push(`Mortgage amount: AED ${known.mortgage_amount}`);
  if (known.typo_check && Array.isArray(known.typo_check) && (known.typo_check as TypoCheck[]).length > 0) {
    const checks = (known.typo_check as TypoCheck[]).map(t => `${t.field} "${t.input}" → did you mean "${t.suggestion}"?`).join("; ");
    contextLines.push(`Typo check (needs confirmation): ${checks}`);
  }
  if (known.skip_mortgage != null) contextLines.push(`Skip mortgage: ${known.skip_mortgage ? "YES" : "NO"}`);
  if (known.sell_timeline) contextLines.push(`Sell timeline: ${known.sell_timeline}`);
  if (known.sell_urgent != null) contextLines.push(`Sell urgency: ${known.sell_urgent ? "YES" : "NO"}`);
  if (known.dubai_hour != null)  contextLines.push(`Dubai time: ${known.dubai_hour}:00 (24h)`);
  if (known.appointment)   contextLines.push(`Appointment: ${known.appointment}`);
  if (known.car && !known.make) contextLines.push(`Car (raw): ${known.car}`);

  const contextBlock = contextLines.length
    ? `\nWhat you already know:\n${contextLines.join("\n")}`
    : "";

  return `You are Kaya, a friendly WhatsApp assistant for Mister Wheelz — a car-buying service in Dubai that buys cars directly from private sellers.

Tone: casual, warm, natural — like texting a helpful friend. Short replies (1–3 sentences). No corporate language.

Hard rules:
- NEVER re-introduce yourself or mention Mister Wheelz after step 0.
- NEVER ask for information already listed in "What you already know".
- NEVER repeat a question already answered in this conversation.
- NEVER ask multiple questions at once.
- NEVER mention "dealership" or "test drive".
- Use the customer's name once you have it.
- Stay on the current step — don't skip ahead or go back.

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
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: buildSystemPrompt(step, known),
      messages,
    });

    const textBlock = response.content.find((block) => block.type === "text");
    if (textBlock?.type === "text") return textBlock.text.trim();

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
      model: MODEL,
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
      model: MODEL,
      max_tokens: 80,
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
- If the make is not in the valid makes list but looks like a typo, set make to "Unknown" and add a typo_check entry.
- If the model is not listed for that make but looks like a typo, set model to "Unknown" and add a typo_check entry.
- Never put model name in "make" or vice versa. Never put year in "model".
- Do NOT overwrite already known fields: ${knownSummary || "nothing yet"}.
- If nothing vehicle-related is in the message, return {}.
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
"I want to sell my car"   → {}
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
