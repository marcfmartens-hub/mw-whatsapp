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
  0: "Greet the customer and introduce yourself ONCE as: 'Hi! I'm Kaya, your car selling assistant at Mister Wheelz 😊' Then ask for their name. You will NEVER introduce yourself again after this step.",
  1: "You already know the customer's name from the context below — use it. Say something natural like 'Nice! We'd love to help you sell your car.' then ask for their phone number so the team can reach them. Do NOT say your name or mention Mister Wheelz again.",
  2: "Acknowledge their phone number naturally. Ask for their car's make, model and year — keep it casual, e.g. 'What car are you looking to sell? (make, model and year)'.",
  3: "React naturally to the car they mentioned, e.g. 'Nice [car]! 👌'. Then ask for the mileage and whether it's GCC or non-GCC specs.",
  4: "Acknowledge the mileage and spec. Ask if there's any outstanding bank loan or finance on the car — keep it short and casual.",
  5: "Acknowledge the loan answer. Ask what day and time works best for them to come by the Mister Wheelz office.",
  6: "Confirm the booking in a warm, casual way. Repeat the exact day and time, thank them by name, and tell them the team is looking forward to seeing them.",
};

const CLOSING_INSTRUCTION =
  "The booking is complete. Warmly close the conversation and remind them of their appointment. No more questions, do not restart.";

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(step: number, known: KnownFields): string {
  const maxStep = Math.max(...Object.keys(STEP_INSTRUCTIONS).map(Number));
  const clampedStep = Math.min(Math.max(step, 0), maxStep + 1);
  const instruction = STEP_INSTRUCTIONS[clampedStep] ?? CLOSING_INSTRUCTION;

  const contextLines: string[] = [];
  if (known.name) contextLines.push(`Customer name: ${known.name}`);
  if (known.phone_number) contextLines.push(`Phone: ${known.phone_number}`);
  if (known.car) contextLines.push(`Car: ${known.car}`);
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
