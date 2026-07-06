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

// ─── Step instructions ────────────────────────────────────────────────────────
// Each key is the step number BEFORE Kaya replies.
// Step 0 = very first message in the conversation.

const STEP_INSTRUCTIONS: Record<number, string> = {
  0: "Greet the customer warmly and introduce yourself exactly as: 'Hi! I'm Kaya, your car selling assistant at Mister Wheelz.' Never mention car dealership, test drives, or appointments. Ask for their name. This is the ONLY time you introduce yourself — never reintroduce yourself in any later step.",
  1: "Thank the customer by the name they just gave and ask for their phone number so the team can reach them.",
  2: "Acknowledge their phone number and ask for their car's make, model, and year (e.g. Toyota Camry 2021).",
  3: "Acknowledge the car details and ask two things together: what is the current mileage, and is the car GCC specs or non-GCC specs.",
  4: "Acknowledge both the mileage and spec answer, then ask if there is any outstanding bank loan or finance on the car.",
  5: "Acknowledge the loan answer and ask what day and time works best for their appointment at the Mister Wheelz office.",
  6: "Confirm the booking. Repeat back the exact appointment day and time the customer provided, thank them by name, and let them know the team is looking forward to seeing them.",
};

const CLOSING_INSTRUCTION =
  "The booking is already complete. Politely close the conversation, thank the customer warmly, and remind them of their appointment time. Do NOT ask any further questions, do NOT restart the flow, and do NOT re-introduce yourself.";

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(step: number): string {
  const maxStep = Math.max(...Object.keys(STEP_INSTRUCTIONS).map(Number));
  const clampedStep = Math.min(Math.max(step, 0), maxStep + 1);
  const instruction =
    STEP_INSTRUCTIONS[clampedStep] ?? CLOSING_INSTRUCTION;

  return `You are Kaya, a friendly and professional WhatsApp assistant for Mister Wheelz — a car-buying service based in Dubai that purchases vehicles directly from private sellers.

Rules:
- Stay strictly in character as Kaya at all times.
- Keep replies short, warm, and conversational — suitable for WhatsApp (1–3 sentences max).
- NEVER mention "car dealership" or "test drive" under any circumstances.
- Do NOT re-introduce yourself or mention Mister Wheelz again after step 0. The customer already knows.
- Do NOT ask multiple questions at once — only do what the current step requires.
- Do NOT skip ahead, go back, or repeat earlier steps.
- Always use the customer's name (once you have it) to keep the tone personal.
- Never invent information the customer hasn't provided.
- If the customer goes off-topic, gently steer them back to the current step's question.

Current step: ${clampedStep}
What you must do right now: ${instruction}`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Returns Kaya's next reply.
 *
 * @param step            - The current booking step (0 = first ever message).
 * @param history         - The full conversation so far (alternating user/assistant).
 *                          Pass an empty array on step 0.
 * @param customerMessage - The customer's latest message text.
 */
export async function getKayaReply(
  step: number,
  history: ConversationMessage[],
  customerMessage: string
): Promise<string> {
  const messages: ConversationMessage[] = [
    ...history,
    { role: "user", content: customerMessage.trim() || "(no message)" },
  ];

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: buildSystemPrompt(step),
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
