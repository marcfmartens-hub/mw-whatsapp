import { KAYA_V3_RULES } from "./rules";

/** Isolated V3 prototype: pure functions, no CRM, WhatsApp or production side effects. */
export type Intent = "stop" | "self_contact" | "human" | "buyer" | "price" | "booking" | "callback" | "seller" | "question" | "unknown";
export type Memory = {
  name?: string; phone?: string; make?: string; model?: string; year?: string;
  mileage?: string; specs?: "GCC" | "Non-GCC" | "Unknown";
  lastQuestion?: string; ignoredName?: boolean; stopped?: boolean;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
};
export type V3Result = { intent: Intent; reply: string; memory: Memory; action: "none" | "handover_requested" | "booking_requested"; violations: string[] };
const has = (s: string, p: RegExp) => p.test(s);
export function classifyIntent(message: string): Intent {
  const s = message.trim();
  if (has(s, /\b(stop (?:messaging|contacting|texting)|do not (?:contact|message|call)|don't (?:contact|message|call)|unsubscribe)\b/i)) return "stop";
  if (has(s, /\b(i(?:'ll| will) (?:call|contact|message|text) you|i(?:'ll| will) get back to you|i(?:'m| am) busy|talk later)\b/i)) return "self_contact";
  if (has(s, /\b(human|real person|agent|manager|representative|speak to (?:someone|a person))\b/i)) return "human";
  if (has(s, /\b(looking to buy|want to buy|buy a car|do you have|cars? for sale|looking for a car)\b/i)) return "buyer";
  if (has(s, /\b(price|how much|valuation|offer|worth|estimate)\b/i)) return "price";
  if (has(s, /\b(book|appointment|inspection|visit|come tomorrow|come today)\b/i)) return "booking";
  if (has(s, /\b(call me|call back|callback|phone me)\b/i)) return "callback";
  if (has(s, /\b(sell|selling|my car|my vehicle)\b/i)) return "seller";
  if (s.endsWith("?")) return "question";
  return "unknown";
}
export function checkResponse(input: string, reply: string, memory: Memory): string[] {
  const errors: string[] = [];
  if (KAYA_V3_RULES.noPriceQuotes && /\b(?:we (?:offer|pay|can give)|your car is worth)\s*(?:AED|DHS|\\d)/i.test(reply)) errors.push("PRICE_QUOTE");
  if (KAYA_V3_RULES.noHomeVisits && /\b(?:we (?:can|will) (?:come|visit) (?:to|at) your (?:home|house|location))\b/i.test(reply)) errors.push("HOME_VISIT");
  if (KAYA_V3_RULES.neverRepeatIgnoredNameQuestion && memory.ignoredName && /\b(?:your name|may i (?:know|have) your name)\b/i.test(reply)) errors.push("REPEATED_NAME");
  if (classifyIntent(input) === "stop" && /\b(?:appointment|inspection|book|callback)\b/i.test(reply)) errors.push("STOP_NOT_RESPECTED");
  return errors;
}
export function v3Turn(previous: Memory, input: string): V3Result {
  const memory: Memory = { ...previous, messages: [...previous.messages] };
  const intent = classifyIntent(input);
  if (memory.lastQuestion === "name" && intent !== "unknown" && !/^(?:my name is|i am|i'm)\s+/i.test(input)) memory.ignoredName = true;
  const nameMatch = input.match(/^(?:my name is|i am|i'm)\s+([a-z][a-z'-]{1,30})\s*$/i);
  if (nameMatch) memory.name = nameMatch[1];
  let reply = ""; let action: V3Result["action"] = "none";
  switch (intent) {
    case "stop": memory.stopped = true; reply = "Understood. We won't message you again unless you contact us."; break;
    case "self_contact": reply = "Of course, take your time. Message us whenever you're ready."; break;
    case "human": action = "handover_requested"; reply = "Of course. I can ask our team to assist you. What would you like them to help with?"; break;
    case "buyer": action = "handover_requested"; reply = "You're looking to buy a car. I'll pass your enquiry to our sales team. What name should they use when contacting you?"; break;
    case "price": reply = "We can confirm an offer after a free, no-obligation inspection. Would you prefer to arrange an inspection or have our purchasing team call you?"; break;
    case "booking": action = "booking_requested"; reply = "Certainly. What day would you like to come for your free inspection? We're closed on Sundays."; break;
    case "callback": action = "handover_requested"; reply = "Of course. I'll help arrange a team callback. Is your WhatsApp number the best number to reach you?"; break;
    case "seller": reply = "Of course, we can help. What's the make, model and year of your car?"; break;
    case "question": reply = "I want to make sure I answer correctly. Could you clarify your question?"; break;
    default: reply = memory.ignoredName ? "How can I help with your car today?" : "Hello! I'm Kaya from Mister Wheelz. May I know your name, please?"; break;
  }
  if (memory.stopped && intent !== "stop") reply = "";
  memory.lastQuestion = /your name/i.test(reply) ? "name" : undefined;
  const violations = checkResponse(input, reply, memory);
  if (violations.length) { reply = "I can ask our team to assist you directly."; action = "handover_requested"; }
  memory.messages.push({role:"user",content:input},{role:"assistant",content:reply});
  return { intent, reply, memory, action, violations };
}
