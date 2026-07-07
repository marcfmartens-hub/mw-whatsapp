import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY as string,
});

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 150;

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
  appointment?: string | null;
  [key: string]: unknown;
};

export type VehicleFields = {
  make?: string;
  model?: string;
  year?: string;
  mileage?: string;
  specs?: string;
};

// ─── Step instructions ────────────────────────────────────────────────────────

const STEP_INSTRUCTIONS: Record<number, string> = {
  0: `Send this greeting EXACTLY (no changes):
"Hi! I'm Kaya, your car selling assistant at Mister Wheelz 😊

Before we start, may I know your name please?"`,

  1: `The customer just told you their name. Greet them warmly by name — e.g. "Hi [name], nice to have you here! 😊 How can I help you today?"
NEVER say your own name (Kaya) or mention Mister Wheelz again after this step.`,

  2: `The customer just told you what they want.
Check "What you already know" for make, model and year.
- If make + model + year are ALL present: react naturally (e.g. "Nice [make] [model] [year]! 👌") and ask ONLY for the mileage and whether it's GCC or non-GCC specs.
- If ANY of make / model / year is missing: say "Sure, I can help! 😊 Could you share the make, model and year of your car?"
Do NOT ask for mileage or specs until make + model + year are all known.`,

  3: `The customer just gave you vehicle details.
Check "What you already know":
- If make + model + year are still missing or incomplete: ask for them first.
- If make + model + year are all present but mileage or specs are missing: ask only for what's missing.
- If make + model + year + mileage + specs are ALL present:
  - If the car year is less than 5 years old (from today 2026): acknowledge and ask if there is any outstanding bank loan or finance on the car.
  - If the car is 5 years old or older: skip the loan question, acknowledge the details and ask what day and time works best for their appointment at the Mister Wheelz office.`,

  4: `The customer answered the loan question. Acknowledge briefly and ask what day and time works best for their appointment at the Mister Wheelz office.`,

  5: `The customer just gave you an appointment day and time. Confirm the full booking in one warm message: use their name, repeat the appointment day and time, and let them know the Mister Wheelz team will be in touch with them on WhatsApp to confirm.`,
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
  if (known.make)         contextLines.push(`Make: ${known.make}`);
  if (known.model)        contextLines.push(`Model: ${known.model}`);
  if (known.year)         contextLines.push(`Year: ${known.year}`);
  if (known.mileage)      contextLines.push(`Mileage: ${known.mileage} km`);
  if (known.specs)        contextLines.push(`Specs: ${known.specs}`);
  if (known.phone_number) contextLines.push(`Phone: ${known.phone_number}`);
  if (known.loan)         contextLines.push(`Loan: ${known.loan}`);
  if (known.appointment)  contextLines.push(`Appointment: ${known.appointment}`);
  if (known.car && !known.make) contextLines.push(`Car (raw): ${known.car}`);

  const contextBlock = contextLines.length
    ? `\nWhat you already know:\n${contextLines.join("\n")}`
    : "";

  return `You are Kaya, a friendly WhatsApp assistant for Mister Wheelz — a car-buying service in Dubai that buys cars directly from private sellers.

Tone: casual, warm, natural — like texting a helpful friend. Short replies (1–3 sentences). No corporate language.

Hard rules:
- NEVER re-introduce yourself or mention Mister Wheelz after step 0.
- NEVER ask for information already listed in "What you already know".
- NEVER ask multiple questions at once.
- NEVER mention "dealership" or "test drive".
- Use the customer's name once you have it.
- Stay on the current step — don't skip ahead or go back.${contextBlock}

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
      system: `Extract car listing details from a customer's WhatsApp message.

Return ONLY a JSON object containing the fields you can confidently identify:
- "make"    — brand only, title case (e.g. "Toyota", "BMW", "Mercedes-Benz")
- "model"   — model only, title case (e.g. "Camry", "520", "C 200", "X5")
- "year"    — 4-digit year as string (e.g. "2019")
- "mileage" — digits only, no units or commas (e.g. "125000")
- "specs"   — exactly "GCC", "Non-GCC", or "Unknown"

Rules:
- Omit any key you are not confident about. Never guess.
- Already known (skip these): ${knownSummary || "nothing yet"}.
- If nothing relevant is in the message, return {}.
- "k" or "K" after a number means thousands (80k = 80000).
- Specs hints: "gcc", "local" → "GCC"; "non gcc", "non-gcc", "personal import", "imported" → "Non-GCC"; "not sure", "don't know", "idk" → "Unknown".

Examples:
"BMW 520 2019"            → {"make":"BMW","model":"520","year":"2019"}
"its a 2021 toyota camry" → {"make":"Toyota","model":"Camry","year":"2021"}
"125k km gcc"             → {"mileage":"125000","specs":"GCC"}
"non gcc"                 → {"specs":"Non-GCC"}
"the year is 2020"        → {"year":"2020"}
"I want to sell"          → {}`,
      messages: [{ role: "user", content: messageText }],
    });

    const block = response.content.find((b) => b.type === "text");
    if (block?.type === "text") {
      const match = block.text.match(/\{[^}]*\}/);
      if (!match) return {};
      const parsed = JSON.parse(match[0]);
      return Object.fromEntries(
        Object.entries(parsed).filter(([, v]) => typeof v === "string" && (v as string).trim() !== "")
      ) as VehicleFields;
    }
  } catch (e) {
    console.error("[extractVehicleInfo] error:", e);
  }
  return {};
}
