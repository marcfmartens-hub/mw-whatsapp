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
  loan?: string | null;
  appointment?: string | null;
  [key: string]: unknown;
};

// ─── Step instructions ────────────────────────────────────────────────────────

const STEP_INSTRUCTIONS: Record<number, string> = {
  0: `Send this greeting EXACTLY (no changes):
"Hi! I'm Kaya, your car selling assistant at Mister Wheelz 😊

Before we start, may I know your name please?"`,

  1: `The customer just told you their name. Use it to greet them warmly — e.g. "Hi [name], nice to have you here! 😊 How can I help you today?"
NEVER mention your name (Kaya) or Mister Wheelz again. This is the last time you ask an open question — after this you guide them through the booking.`,

  2: `The customer just told you what they want (sell their car, get a quote, etc.).
Check "What you already know" for make, model and year.

- If make + model + year are ALL present: react naturally to the car (e.g. "Nice [make] [model] [year]! 👌") and ask ONLY for the mileage and whether it's GCC or non-GCC specs.
- If ANY of make / model / year is missing: say "Sure, I can help you with that! 😊 I just need a couple of details — what's the make, model and year of your car?"

Do NOT ask for mileage or anything else until you have make + model + year.`,

  3: `The customer just gave you mileage and/or specs. Check "What you already know".
- If both mileage (a number) and specs (GCC or Non-GCC) are present: acknowledge them ("Got it — [mileage] km, [specs] 👍") and ask if there is any outstanding bank loan or finance on the car.
- If either is still missing: politely ask only for what's missing. Do NOT ask about loan yet.`,

  4: `The customer answered the loan question. Acknowledge briefly and ask what day and time works best for their appointment at the Mister Wheelz office.`,

  5: `The customer just gave you an appointment day and time. Acknowledge it, then ask for their phone number so the team can confirm the appointment with them.`,

  6: `The customer just gave you their phone number. Now confirm the full booking in one warm message: repeat their name, the appointment day and time, and let them know the team will be in touch on that number. Keep it short and friendly.`,
};

const CLOSING_INSTRUCTION =
  "The booking is complete. If the customer messages again, warmly let them know everything is set and the team will reach out. No more questions, do not restart the flow.";

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(step: number, known: KnownFields): string {
  const maxStep = Math.max(...Object.keys(STEP_INSTRUCTIONS).map(Number));
  const clampedStep = Math.min(Math.max(step, 0), maxStep + 1);
  const instruction = STEP_INSTRUCTIONS[clampedStep] ?? CLOSING_INSTRUCTION;

  const contextLines: string[] = [];
  if (known.name) contextLines.push(`Customer name: ${known.name}`);
  if (known.car) contextLines.push(`Car (raw): ${known.car}`);
  if ((known as any).make) contextLines.push(`Make: ${(known as any).make}`);
  if ((known as any).model) contextLines.push(`Model: ${(known as any).model}`);
  if ((known as any).year) contextLines.push(`Year: ${(known as any).year}`);
  if (known.mileage) contextLines.push(`Mileage: ${known.mileage} km`);
  if ((known as any).specs) contextLines.push(`Specs: ${(known as any).specs}`);
  if (known.phone_number) contextLines.push(`Phone: ${known.phone_number}`);
  if (known.loan) contextLines.push(`Loan: ${known.loan}`);
  if (known.appointment) contextLines.push(`Appointment: ${known.appointment}`);
  const contextBlock = contextLines.length
    ? `\nWhat you already know:\n${contextLines.join("\n")}`
    : "";

  return `You are Kaya, a friendly WhatsApp assistant for Mister Wheelz — a car-buying service in Dubai that buys cars directly from private sellers.

Tone: casual, warm, natural — like texting a helpful friend. Short replies (1–3 sentences). No corporate language.

Hard rules:
- NEVER re-introduce yourself or mention Mister Wheelz after step 0.
- NEVER ask for information you already have (check "What you already know" below).
- NEVER ask multiple questions at once.
- NEVER mention "dealership" or "test drive".
- Use the customer's name once you have it.
- Stay on the current step — don't skip ahead or go back.${contextBlock}

Current step: ${clampedStep}
What to do now: ${instruction}`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

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
    if (textBlock?.type === "text") {
      return textBlock.text.trim();
    }

    return "Sorry, could you say that again?";
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error("[Kaya] Claude API error:", message);
    return "Sorry, I'm having a little trouble right now — could you try again in a moment? 🙏";
  }
}

// ─── Field extractors ─────────────────────────────────────────────────────────

export async function extractCarFields(
  carText: string
): Promise<{ make: string; model: string; year: string }> {
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 60,
      system: `Extract car details from the customer's message. Reply with ONLY a valid JSON object with keys "make", "model", "year". Use proper title case. If a value is unclear use "".
Examples:
"Toyota Camry 2021" → {"make":"Toyota","model":"Camry","year":"2021"}
"bmw 3 series 2019" → {"make":"BMW","model":"3 Series","year":"2019"}
"its a 2015 nissan patrol" → {"make":"Nissan","model":"Patrol","year":"2015"}`,
      messages: [{ role: "user", content: carText }],
    });
    const block = response.content.find((b) => b.type === "text");
    if (block?.type === "text") {
      return JSON.parse(block.text.trim());
    }
  } catch {}
  return { make: "", model: "", year: "" };
}

export async function extractMileageSpec(
  text: string
): Promise<{ mileage: string; specs: string }> {
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 60,
      system: `Extract mileage and spec from the customer's message. Reply with ONLY a valid JSON object with keys "mileage" (digits only, no units or commas) and "specs" (exactly one of: "GCC", "Non-GCC", "Unknown").
Examples:
"50000 km gcc" → {"mileage":"50000","specs":"GCC"}
"120,000 non gcc" → {"mileage":"120000","specs":"Non-GCC"}
"about 80k not sure" → {"mileage":"80000","specs":"Unknown"}
"i don't know" → {"mileage":"","specs":"Unknown"}`,
      messages: [{ role: "user", content: text }],
    });
    const block = response.content.find((b) => b.type === "text");
    if (block?.type === "text") {
      return JSON.parse(block.text.trim());
    }
  } catch {}
  return { mileage: "", specs: "Unknown" };
}

// ─── Usage example (remove in production) ────────────────────────────────────
//
// Maintain `history` and `step` in your session store (e.g. Redis, DB row).
// After each exchange:
//   1. Push { role: "user",      content: customerMessage } to history.
//   2. Push { role: "assistant", content: kayaReply }       to history.
//   3. Increment step by 1.
//
// const history: ConversationMessage[] = [];
// let step = 0;
//
// const reply = await getKayaReply(step, history, "Hey");
// history.push({ role: "user", content: "Hey" });
// history.push({ role: "assistant", content: reply });
// step++;
