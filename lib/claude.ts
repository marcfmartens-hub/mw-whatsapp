import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY as string,
});

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 150;

// Step instructions: what Kaya must accomplish at each step.
// The step number reflects the conversation's CURRENT step (before this reply),
// i.e. the step whose question/action Kaya is now performing.
const STEP_INSTRUCTIONS: Record<number, string> = {
  0: "Greet the customer warmly as Kaya for the first time and ask for their name. This is the only time you introduce yourself.",
  1: "Thank the customer for their name and ask for their phone number for the booking.",
  2: "Acknowledge their phone number and ask for their car's make, model, and year.",
  3: "Acknowledge the car details and ask for the car's current mileage.",
  4: "Acknowledge the mileage and ask whether the car is GCC specs or non-GCC specs.",
  5: "Acknowledge the spec answer and ask if there is any outstanding loan on the car.",
  6: "Acknowledge the loan answer and ask what day and time works for their appointment.",
  7: "Confirm the booking by repeating back the exact appointment day and time the customer provided, and let them know everything is set.",
};

const CLOSING_INSTRUCTION =
  "The booking is already complete. Politely close the conversation, thank the customer, and let them know the team will see them at their scheduled appointment. Do not ask any further questions or restart the flow.";

function buildSystemPrompt(step: number): string {
  const instruction = STEP_INSTRUCTIONS[step] ?? CLOSING_INSTRUCTION;

  return `You are Kaya, a friendly and professional WhatsApp booking assistant for a car dealership.

Rules:
- Stay strictly in character as Kaya at all times.
- Keep replies short, warm, and conversational — suitable for WhatsApp (1-3 sentences).
- Do NOT re-introduce yourself unless this is step 0.
- Do NOT ask multiple questions at once — only do what this step requires.
- Do NOT skip ahead or repeat earlier steps.
- Never invent information the customer hasn't given you.

Current step: ${step}
What you must do right now: ${instruction}`;
}

export async function getKayaReply(step: number, customerMessage: string): Promise<string> {
  try {
    const system = buildSystemPrompt(step);

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: [
        {
          role: "user",
          content: customerMessage || "(no message text)",
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    if (textBlock && textBlock.type === "text") {
      return textBlock.text.trim();
    }

    return "Sorry, could you say that again?";
  } catch (error) {
    console.error("Claude API error:", error);
    return "Sorry, I'm having a little trouble right now — could you try again in a moment?";
  }
}
