import { NextRequest, NextResponse } from "next/server";
import { getOrCreateConversation, updateConversation, resetConversation, Conversation } from "@/lib/supabase";
import { getKayaReply, extractVehicleInfo, extractAppointment, VehicleFields, ConversationMessage } from "@/lib/claude";
import { sendWhatsAppMessage, sendWhatsAppImage } from "@/lib/meta";
import { createBiginContact } from "@/lib/bigin";
import { CAR_MODELS } from "@/lib/carData";
import { estimateCarValue } from "@/lib/valuation";

export const dynamic = "force-dynamic";

const RESET_KEYWORD = "reset chat 007";

const LOCATION_KEYWORDS = /\b(location|address|where are you|where is|how to get|directions?|map|find you|your office|office location|come to you)\b/i;

const LOCATION_IMAGE_URL = "https://mw-whatsapp2.vercel.app/location.jpg";

const LOCATION_TEXT = `📍 Mister Wheelz Car Buyers

409 Sheikh Zayed Rd
F1rst Motors Bldg.
1st Floor, Office 7
Al Quoz First - Dubai

Entrance - Left side of the Building

https://maps.app.goo.gl/4L7EkwGZfnffofuh8`;

// ---- GET: Meta webhook verification ----
export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = process.env.WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && token && verifyToken && token === verifyToken) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

// Which raw field to save at each step (the customer's plain text answer).
// Vehicle details (make/model/year/mileage/specs) are extracted separately
// from every message and saved on top of this.
const FIELD_BY_STEP: Record<number, keyof Conversation | undefined> = {
  0: undefined,          // first contact — nothing to save
  1: "name",             // customer gives name
  2: "phone_number",     // UAE contact number (only asked when sender is non-UAE)
  3: "car",              // customer states intent / car info
  4: undefined,          // mileage+specs collected via vehicle extraction only
  5: "loan",             // loan status (skipped for cars 5+ years old)
  6: "sell_timeline",    // when do they want to sell? (summary no longer waits for confirmation)
  7: "appointment",      // appointment day/time — Bigin fires after this
};

const FINAL_STEP  = 7;
const CLOSING_STEP = 8;

const URGENT_KEYWORDS  = /\b(today|now|right now|asap|any\s*time|whenever|when the price is right|immediately|urgent)\b/i;
const GREETING_ONLY   = /^(hi+|hey+|hello+|hiya|yo|howdy|good\s*(morning|afternoon|evening|day|evening))[\s!.,]*$/i;

function getDubaiHour(): number {
  return new Date(Date.now() + 4 * 60 * 60 * 1000).getUTCHours();
}

function getDubaiTomorrow(): string {
  // Dubai = UTC+4; tomorrow = today+24h from that offset
  const d = new Date(Date.now() + 28 * 60 * 60 * 1000);
  const DAYS   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const date   = d.getUTCDate();
  const sfx    = [11,12,13].includes(date) ? "th"
                 : date % 10 === 1 ? "st"
                 : date % 10 === 2 ? "nd"
                 : date % 10 === 3 ? "rd" : "th";
  return `${DAYS[d.getUTCDay()]} ${date}${sfx} of ${MONTHS[d.getUTCMonth()]}`;
}

// Extract just the real name from messages like "im Marc", "I'm Marc", "my name is Marc".
function extractNameFromMessage(text: string): string | null {
  const m = text.match(
    /(?:i'?m\s+|i\s+am\s+|my\s+name(?:\s+is)?\s+|it'?s\s+|this\s+is\s+|name\s+is\s+|call\s+me\s+)([A-Za-z][a-z]*(?:\s+[A-Za-z][a-z]*)?)/i
  );
  if (m) return m[1].trim().replace(/\b\w/g, (c) => c.toUpperCase());
  // Whole message is a simple name: 1–2 words, letters only, under 30 chars
  const trimmed = text.trim();
  if (/^[A-Za-z]+(?:\s+[A-Za-z]+)?$/.test(trimmed) && trimmed.length <= 30)
    return trimmed.replace(/\b\w/g, (c) => c.toUpperCase());
  // Can't identify a real name — don't save anything
  return null;
}

// Deterministic fallback: scan message for any known model of the given make.
// Used when the LLM extractor misses the model (e.g. "X7 sorry", "I mean Camry").
function quickModelMatch(text: string, make: string): string | undefined {
  const models = CAR_MODELS[make];
  if (!models) return undefined;
  // Sort longest first so "X5 M" matches before "X5"
  const sorted = [...models].sort((a, b) => b.length - a.length);
  for (const m of sorted) {
    const escaped = m.replace(/[-/]/g, "[-/]?").replace(/\s+/g, "\\s+");
    if (new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z0-9])`, "i").test(text)) return m;
  }
  return undefined;
}

function formatMileage(raw: string | null | undefined): string {
  if (!raw) return "Unknown";
  const n = parseInt(raw, 10);
  if (isNaN(n)) return `${raw} km`;
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " km";
}

// Typed action tokens — set by webhook logic, consumed by buildDirectResponse.
// Using a discriminated union avoids fragile substring matching.
type NextAction =
  | { type: "ASK_NAME" }
  | { type: "ASK_UAE_PHONE" }
  | { type: "ASK_CAR_DETAILS" }
  | { type: "ASK_MILEAGE_SPECS" }
  | { type: "ASK_SPECS" }
  | { type: "ASK_MORTGAGE" }
  | { type: "ASK_AMOUNT" }
  | { type: "CLARIFY_MODEL" }
  | { type: "SHOW_SUMMARY" }
  | { type: "SHOW_FULL_SUMMARY" }
  | { type: "OFFER_CALLBACK" };

// Human-readable version sent to the LLM (for nuanced fallback cases)
function describeAction(a: NextAction): string {
  switch (a.type) {
    case "ASK_NAME":         return `Reply with exactly: "And what's your name? 😊"`;
    case "ASK_UAE_PHONE":    return "Ask: \"On which UAE number can we reach you on?\"";
    case "ASK_CAR_DETAILS":  return "Ask for the car make, model and year.";
    case "ASK_MILEAGE_SPECS":return "Ask for BOTH the mileage AND whether the car is GCC or non-GCC specs — in one question.";
    case "ASK_SPECS":        return `Ask ONLY: "Is it GCC or non-GCC specs?"`;
    case "ASK_MORTGAGE":     return `Ask: "Is there any outstanding mortgage on the car?"`;
    case "ASK_AMOUNT":       return `Ask: "How much is the outstanding balance?"`;
    case "CLARIFY_MODEL":    return "Ask the customer to confirm or clarify the car model and year.";
    case "SHOW_SUMMARY":      return `Show the car summary (plain, no emojis) then ask "When are you planning to sell the car?"`;
    case "SHOW_FULL_SUMMARY": return `Show the car summary including mortgage (plain, no emojis) then ask "When are you planning to sell the car?"`;
    case "OFFER_CALLBACK":   return "Tell the customer the purchasing team will call them back within the hour, and they're welcome to come in whenever.";
  }
}

// Build the reply directly from the action token — no LLM needed for these cases.
function buildDirectResponse(
  action: NextAction,
  name: string | null | undefined,
  known: { make?: string | null; model?: string | null; year?: string | null;
           mileage?: string | null; specs?: string | null;
           loan?: string | null; mortgage_amount?: string | null }
): string {
  const n = name ? `, ${name}` : "";
  switch (action.type) {
    case "ASK_NAME":
      return "And what's your name? 😊";
    case "ASK_UAE_PHONE":
      return `Hi${n}! 😊 On which UAE number can we reach you on?`;
    case "ASK_CAR_DETAILS": {
      // Only ask for what's still missing — don't repeat info already given
      const hasMake  = !!(known.make  && known.make  !== "Unknown");
      const hasModel = !!(known.model && known.model !== "Unknown");
      if (hasMake && hasModel) {
        return `Alright, nice ${known.make} ${known.model}! Which year is it?`;
      } else if (hasMake) {
        return `Got it — ${known.make}! What's the model and year?`;
      }
      return `Sure${n}, I can help! 😊 Could you share the make, model and year of your car?`;
    }
    case "ASK_MILEAGE_SPECS":
      return `Got it${n}! 👌 Could you tell me the mileage and whether it's GCC or non-GCC specs?`;
    case "ASK_SPECS":
      return `Got it${n}! Is it GCC or non-GCC specs?`;
    case "ASK_MORTGAGE":
      return "Is there any outstanding mortgage on the car?";
    case "ASK_AMOUNT":
      return "How much is the outstanding balance?";
    case "CLARIFY_MODEL":
      return `Could you confirm the car model and year${n}?`;
    case "SHOW_SUMMARY":
    case "SHOW_FULL_SUMMARY":
      // No mid-flow summary — go straight to sell timeline question
      return "When are you planning to sell the car?";
    case "OFFER_CALLBACK":
      return "No worries — I'll have someone from our team call you back within the hour. Whenever you're ready to come in, we're here for you.";
  }
}

function getDubaiDateStr(): string {
  const d = new Date(Date.now() + 4 * 60 * 60 * 1000);
  const DAYS   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function getDubaiDateTime(): string {
  const d = new Date(Date.now() + 4 * 60 * 60 * 1000);
  const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${d.getUTCDate()} ${d.getUTCFullYear()}, ${hh}:${mm}`;
}

interface IncomingMessage {
  from: string;
  id: string;
  text?: { body?: string };
  image?: { caption?: string };
  type: string;
}

function extractMessage(body: any): IncomingMessage | null {
  try {
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    if (!value?.messages || value.messages.length === 0) return null;
    const message = value.messages[0];
    return { from: message.from, id: message.id, text: message.text, image: message.image, type: message.type };
  } catch (error) {
    console.error("extractMessage parse error:", error);
    return null;
  }
}

// ---- POST: incoming message handler ----
export async function POST(req: NextRequest) {
  let body: any;

  try {
    body = await req.json();
  } catch (error) {
    console.error("Failed to parse webhook body:", error);
    return NextResponse.json({ status: "ignored" }, { status: 200 });
  }

  try {
    const message = extractMessage(body);
    if (!message) return NextResponse.json({ status: "ignored" }, { status: 200 });

    const ownPhoneNumberId = process.env.META_PHONE_NUMBER_ID;
    if (ownPhoneNumberId && message.from === ownPhoneNumberId) {
      return NextResponse.json({ status: "ignored" }, { status: 200 });
    }

    const phone   = message.from;
    const isUAE   = phone.startsWith("971");
    const isImageMessage = message.type === "image";
    // Use image caption as text when no text body (e.g. photo sent with description)
    const messageText = message.text?.body?.trim() ?? message.image?.caption?.trim() ?? "";

    // ── Reset trigger ──────────────────────────────────────────────
    if (messageText.toLowerCase() === RESET_KEYWORD) {
      await resetConversation(phone);
      await sendWhatsAppMessage(phone, "Chat has been reset. Send a message to start again. 👋");
      return NextResponse.json({ status: "reset" }, { status: 200 });
    }
    // ──────────────────────────────────────────────────────────────

    // ── Location trigger ───────────────────────────────────────────
    const isLocationMessage = message.type === "location";
    const isLocationRequest = LOCATION_KEYWORDS.test(messageText);
    if (isLocationMessage || isLocationRequest) {
      await sendWhatsAppImage(phone, LOCATION_IMAGE_URL);
      await sendWhatsAppMessage(phone, LOCATION_TEXT);
      // If we're in the appointment booking step, nudge them to pick a time
      const convForLocation = await getOrCreateConversation(phone);
      if ((convForLocation.step ?? 0) >= FINAL_STEP - 1) {
        await sendWhatsAppMessage(phone, "What time works best for you to bring the car in?");
      }
      return NextResponse.json({ status: "location_sent" }, { status: 200 });
    }
    // ──────────────────────────────────────────────────────────────

    const conversation = await getOrCreateConversation(phone);

    // Auto-save WhatsApp number as phone_number if not set yet
    if (!conversation.phone_number) {
      await updateConversation(phone, { phone_number: phone });
      conversation.phone_number = phone;
    }

    if (conversation.last_msg_id && conversation.last_msg_id === message.id) {
      return NextResponse.json({ status: "duplicate" }, { status: 200 });
    }

    const currentStep = conversation.step ?? 0;
    const fieldToSave = FIELD_BY_STEP[currentStep];

    // ── Core update (guaranteed columns only) ──────────────────────
    const coreUpdates: Partial<Conversation> = {
      last_msg_id: message.id,
      last_message_at: new Date().toISOString(),
    };
    if (fieldToSave && messageText) {
      // Don't overwrite an already-saved loan answer with a mortgage amount follow-up
      const isLoanAmountFollowUp = fieldToSave === "loan" && !!conversation.loan;
      // Don't save a greeting ("hi", "hello") as the customer's name
      const isGreetingOnly = fieldToSave === "name" && GREETING_ONLY.test(messageText);
      if (!isLoanAmountFollowUp && !isGreetingOnly) {
        const valueToSave = fieldToSave === "name"
          ? extractNameFromMessage(messageText)
          : messageText;
        // null means extractNameFromMessage couldn't find a real name — skip saving
        if (valueToSave !== null) {
          (coreUpdates as any)[fieldToSave] = valueToSave;
        }
      }
    }

    // ── Vehicle extraction — runs on EVERY message ─────────────────
    // Scans for make/model/year/mileage/specs regardless of step,
    // so it doesn't matter how the customer spreads the info.
    // Don't tell extractor "Unknown" make/model — let it keep trying on every message
    const alreadyKnown: VehicleFields = {
      make:    (conversation.make    && conversation.make    !== "Unknown") ? conversation.make    : undefined,
      model:   (conversation.model   && conversation.model   !== "Unknown") ? conversation.model   : undefined,
      year:    conversation.year    ?? undefined,
      mileage: conversation.mileage ?? undefined,
      specs:   conversation.specs   ?? undefined,
    };
    const vehicleUpdates = await extractVehicleInfo(messageText, alreadyKnown);

    // ── Deterministic model fallback ───────────────────────────────
    // If the extractor didn't return a model (e.g. "X7 sorry", "I mean Camry"),
    // scan the raw message text for any known model of the established make.
    if (!vehicleUpdates.model || vehicleUpdates.model === "Unknown") {
      const effectiveMake = vehicleUpdates.make ?? conversation.make;
      if (effectiveMake && effectiveMake !== "Unknown") {
        const found = quickModelMatch(messageText, effectiveMake);
        if (found) {
          vehicleUpdates.model = found;
          // Remove any stale typo entry for this field now that we have a real model
          if (vehicleUpdates.typo_check) {
            vehicleUpdates.typo_check = vehicleUpdates.typo_check.filter(
              (t) => t.field !== "model"
            );
            if (vehicleUpdates.typo_check.length === 0) delete vehicleUpdates.typo_check;
          }
        }
      }
    }

    // ── Guard: don't let extractor overwrite already-confirmed fields ──
    // e.g. "340k" at the mortgage step must not overwrite mileage "12k".
    // The extractor's "do not overwrite" instruction isn't 100% reliable,
    // so we enforce it here too for mileage and specs.
    if (alreadyKnown.mileage && vehicleUpdates.mileage) delete vehicleUpdates.mileage;
    if (alreadyKnown.specs   && vehicleUpdates.specs)   delete vehicleUpdates.specs;

    // ── Explicit "I don't know specs" detection ────────────────────
    // If at step 4, specs not yet known, and customer expresses uncertainty → record Unknown
    const SPECS_UNSURE = /\b(i\s*don'?t\s*know|not\s*sure|no\s*idea|unsure|idk|not\s*sure\s*about|unclear)\b/i;
    const hasKnownSpecs = (vehicleUpdates.specs && vehicleUpdates.specs !== "Unknown")
                          || (conversation.specs && conversation.specs !== "Unknown");
    const specsExplicitlyUnknown = currentStep === 4 && !hasKnownSpecs && SPECS_UNSURE.test(messageText);
    if (specsExplicitlyUnknown) vehicleUpdates.specs = "Unknown";

    // ── Appointment extraction — runs EARLY for step 8 so the LLM has ──
    // accumulated date/time context on every back-and-forth exchange.
    let apptDate = conversation.appointment_date ?? "";
    let apptTime = conversation.appointment_time ?? "";
    if (currentStep === FINAL_STEP && messageText) {
      try {
        const ea = await extractAppointment(messageText);
        if (ea.appointment_date) apptDate = ea.appointment_date;
        if (ea.appointment_time) apptTime  = ea.appointment_time;
        // Persist immediately so context is accurate on next turn
        const apptSave: Partial<Conversation> = {};
        if (ea.appointment_date) apptSave.appointment_date = ea.appointment_date;
        if (ea.appointment_time) apptSave.appointment_time  = ea.appointment_time;
        if (Object.keys(apptSave).length > 0)
          await updateConversation(phone, apptSave);
      } catch (e) {
        console.error("early appointment extraction error:", e);
      }
    }

    // ── Build knownFields for Kaya's system prompt ─────────────────
    // At step 7 (sell timeline answer), detect urgency and pass Dubai hour
    const sellTimeline = fieldToSave === "sell_timeline" ? messageText : (conversation.sell_timeline ?? undefined);
    const sellUrgent   = sellTimeline ? URGENT_KEYWORDS.test(sellTimeline) : undefined;
    // ── Mortgage amount extraction ─────────────────────────────────
    // Runs at step 4 whether the customer says "yes 50k" in one go,
    // or says "yes" first and provides the amount as a follow-up.
    let mortgageAmount: string | undefined;
    // Use the saved loan answer when collecting the amount (follow-up message).
    // Without this, "340k" would be the loanAnswer and loanIsYes would be false.
    const isLoanFollowUp = fieldToSave === "loan" && !!conversation.loan;
    const loanAnswer = isLoanFollowUp ? (conversation.loan ?? "") : (fieldToSave === "loan" ? messageText : (conversation.loan ?? ""));
    const loanIsYes  = /\byes\b|\bdo\b|have a|there is|outstanding/i.test(loanAnswer);
    if (currentStep === 5 && loanIsYes && messageText) {
      const amountMatch = messageText.match(/[\d,]+(?:\.\d+)?(?:\s*k\b)?/i);
      if (amountMatch) {
        const raw = amountMatch[0].replace(/,/g, "").trim();
        mortgageAmount = /k$/i.test(raw)
          ? String(parseFloat(raw) * 1000)
          : raw;
      }
    }

    const carYear    = parseInt((vehicleUpdates.year ?? conversation.year) || "0");
    const carMileage = vehicleUpdates.mileage ?? conversation.mileage;
    const carSpecs   = (vehicleUpdates.specs && vehicleUpdates.specs !== "Unknown")
                         ? vehicleUpdates.specs
                         : (conversation.specs && conversation.specs !== "Unknown" ? conversation.specs : null);
    const currentYear = new Date().getFullYear();
    // All vehicle fields must be present before leaving step 4.
    // specsExplicitlyUnknown counts as "answered" so the flow continues.
    const hasAllVehicleFields = !!carMileage && (!!carSpecs || specsExplicitlyUnknown
                                  || conversation.specs === "Unknown");
    // Skip mortgage for cars 5+ years old (only once mileage+specs are collected)
    const skipLoan = currentStep === 4 && hasAllVehicleFields && carYear > 0 && (currentYear - carYear) >= 10;

    // ── Auto-correct typos silently — no "did you mean?" confirmation needed ──
    if (Array.isArray(vehicleUpdates.typo_check) && vehicleUpdates.typo_check.length > 0) {
      for (const tc of vehicleUpdates.typo_check) {
        if (tc.field === "model" && (!vehicleUpdates.model || vehicleUpdates.model === "Unknown")) {
          vehicleUpdates.model = tc.suggestion;
          console.log(`[kaya] typo auto-corrected: model "${tc.input}" → "${tc.suggestion}"`);
        }
        if (tc.field === "make" && (!vehicleUpdates.make || vehicleUpdates.make === "Unknown")) {
          vehicleUpdates.make = tc.suggestion;
          console.log(`[kaya] typo auto-corrected: make "${tc.input}" → "${tc.suggestion}"`);
        }
      }
      vehicleUpdates.typo_check = []; // clear so it doesn't show in context
    }

    // ── Compute next_action for steps 2–4 so the model executes one clear directive ──
    // The webhook evaluates all conditions; the model just phrases the result naturally.
    const hasTypo  = false; // typos are now auto-corrected silently, never surfaced
    const hasModel = !!(vehicleUpdates.make ?? conversation.make) && !!(
      (vehicleUpdates.model && vehicleUpdates.model !== "Unknown") ||
      (conversation.model   && conversation.model   !== "Unknown")
    );
    const hasYear  = !!(vehicleUpdates.year ?? conversation.year);
    const hasSpecs = !!carSpecs || specsExplicitlyUnknown || conversation.specs === "Unknown";

    let action: NextAction | undefined;

    if (currentStep === 1 && GREETING_ONLY.test(messageText)) {
      action = { type: "ASK_NAME" };
    } else if (currentStep === 1 && !isUAE) {
      // Non-UAE sender: after collecting name, ask for their UAE contact number
      action = { type: "ASK_UAE_PHONE" };
    } else if (currentStep === 2) {
      // UAE phone just provided — move straight to asking about the car
      action = { type: "ASK_CAR_DETAILS" };
    } else if (currentStep === 3) {
      if (!hasModel || !hasYear) {
        action = { type: "ASK_CAR_DETAILS" };
      } else {
        action = { type: "ASK_MILEAGE_SPECS" };
      }
    } else if (currentStep === 4) {
      if (!hasModel || !hasYear) {
        action = { type: "CLARIFY_MODEL" };
      } else if (!carMileage) {
        action = { type: "ASK_MILEAGE_SPECS" };
      } else if (!hasSpecs) {
        action = { type: "ASK_SPECS" };
      } else if (skipLoan) {
        action = { type: "SHOW_SUMMARY" };
      } else {
        action = { type: "ASK_MORTGAGE" };
      }
    } else if (currentStep === 5 && loanIsYes && !mortgageAmount && !conversation.mortgage_amount) {
      action = { type: "ASK_AMOUNT" };
    } else if (currentStep === 5) {
      // Mortgage step is complete (loan=No, or loan=Yes+amount collected) — show full summary directly
      action = { type: "SHOW_FULL_SUMMARY" };
    }

    // ── Callback detection ─────────────────────────────────────────
    // Triggers when the customer is stuck and needs a human touch.
    // Three independent signals — any one is enough:
    //   A) Customer explicitly asks to speak to a person / human / agent
    //   B) Still pushing for price at the appointment step (whole flow done, still not happy)
    //   C) History shows 3 options were already explained and they're still pushing price
    // ── Callback detection ─────────────────────────────────────────
    // Fire when the customer is stuck — any one of these signals is enough:
    //   A) Explicitly asks for a human / to speak to someone
    //   B) At appointment step, still pushing for price (whole flow done, still not committing)
    //   C) Avoiding booking after options were already explained (price push or flat refusal)
    const PRICE_PUSH      = /\b(price|offer|estimate|range|how much|what.*(worth|pay|give)|give me.*price|tell me.*price)\b/i;
    const HUMAN_REQUEST   = /\b(speak to|talk to|call me|speak with|agent|human|person|manager|someone from|real person|staff)\b/i;
    const BOOKING_REFUSAL = /\b(no[,.]?\s*(thanks|thank you|i|i'll)?|not\s*(now|yet|today|ready|going)|i'?ll\s*(think|let you|pass)|maybe later|don'?t\s*want|not\s*interested)\b/i;
    const THREE_OPTIONS_SENT = /three ways to sell|direct cash sale|consignment.*private|we offer three/i;
    const alreadyExplainedOptions = history.some(
      m => m.role === "assistant" && THREE_OPTIONS_SENT.test(m.content)
    );
    const callbackSignal =
      HUMAN_REQUEST.test(messageText) ||
      (currentStep >= FINAL_STEP && PRICE_PUSH.test(messageText)) ||
      (alreadyExplainedOptions && (PRICE_PUSH.test(messageText) || BOOKING_REFUSAL.test(messageText)));
    if (!action && currentStep >= 5 && callbackSignal) {
      action = { type: "OFFER_CALLBACK" };
    }

    // Compute a rough market estimate when make/model/year are all known
    const estMake    = (vehicleUpdates.make  ?? conversation.make)  ?? "";
    const estModel   = (vehicleUpdates.model ?? conversation.model) ?? "";
    const estYear    = (vehicleUpdates.year  ?? conversation.year)  ?? "";
    const estMileage = vehicleUpdates.mileage ?? conversation.mileage;
    const estSpecs   = vehicleUpdates.specs   ?? conversation.specs;
    const valuation  = (estMake && estModel && estModel !== "Unknown" && estYear)
      ? estimateCarValue(estMake, estModel, estYear, estMileage, estSpecs)
      : null;

    const knownFields = {
      ...conversation,
      ...coreUpdates,
      ...vehicleUpdates,
      image_shared: isImageMessage || undefined,
      sell_timeline:    sellTimeline,
      sell_urgent:      sellUrgent,
      dubai_hour:       getDubaiHour(),
      dubai_datetime:   getDubaiDateTime(),
      dubai_tomorrow:   getDubaiTomorrow(),
      mortgage_amount:  mortgageAmount ?? conversation.mortgage_amount,
      skip_mortgage:    hasAllVehicleFields && carYear > 0 && (currentYear - carYear) >= 10,
      estimated_value:  valuation?.formatted ?? null,
      next_action:      action ? describeAction(action) : undefined,
      // Progressive appointment context — accumulated across step 8 exchanges
      appointment_date: apptDate || conversation.appointment_date || undefined,
      appointment_time: apptTime || conversation.appointment_time || undefined,
    };

    console.log(`[kaya] step=${currentStep} action=${action?.type ?? "none"}`);

    // Steps with a typed action always get a direct template response — zero LLM hallucination risk.
    // Steps without an action (6, 7, 8) go to the LLM — pass the full conversation history
    // so the model remembers what was already said (prevents "which day?" after "tomorrow" etc.)
    const history: ConversationMessage[] = (conversation.messages ?? []) as ConversationMessage[];
    const reply = action
      ? buildDirectResponse(action, (knownFields.name ?? conversation.name) as string | null, knownFields)
      : await getKayaReply(currentStep, history, messageText, knownFields);

    // Detect confirmation early so we can append the location note to the reply
    const appointmentConfirmedEarly = currentStep === FINAL_STEP && !action &&
      /team will be in touch on whatsapp/i.test(reply);

    // Split on [SPLIT] markers so summaries and follow-up questions go as separate WhatsApp messages
    const replyParts = reply.split(/\[SPLIT\]/i).map(s => s.trim()).filter(Boolean);
    if (appointmentConfirmedEarly && replyParts.length > 0) {
      replyParts[replyParts.length - 1] += "\n\nHere below is our location.";
    }
    for (const part of replyParts) {
      await sendWhatsAppMessage(phone, part);
    }

    if (appointmentConfirmedEarly) {
      await sendWhatsAppImage(phone, LOCATION_IMAGE_URL);
      await sendWhatsAppMessage(phone, LOCATION_TEXT);
    }

    // Callback path: send location + push to Bigin with a "today 08:00" appointment (internal flag)
    if (action?.type === "OFFER_CALLBACK") {
      await sendWhatsAppMessage(phone, "You're also welcome to walk in whenever — here's where to find us.");
      await sendWhatsAppImage(phone, LOCATION_IMAGE_URL);
      await sendWhatsAppMessage(phone, LOCATION_TEXT);
      try {
        const callbackConv = {
          ...conversation,
          appointment_date: getDubaiDateStr(),
          appointment_time: "08:00",
        } as Conversation;
        await createBiginContact(callbackConv);
        await updateConversation(phone, { bigin_pushed_at: new Date().toISOString() } as any);
      } catch (e) {
        console.error("callback Bigin push error (non-fatal):", e);
      }
    }

    // ── Persist conversation history ───────────────────────────────
    // Keep the last 40 messages (~20 exchanges) so context stays fresh
    // without growing unbounded. Fails silently if column not yet migrated.
    try {
      const updatedHistory: ConversationMessage[] = [
        ...history,
        { role: "user"      as const, content: messageText },
        { role: "assistant" as const, content: reply },
      ].slice(-40);
      await updateConversation(phone, { messages: updatedHistory } as any);
    } catch (e) {
      console.error("history save error (non-fatal):", e);
    }

    // ── Detect booking confirmation in the reply ───────────────────
    const appointmentConfirmed = appointmentConfirmedEarly;

    // ── Persist core update + advance step ─────────────────────────
    // Stay at step 4 until BOTH mileage and specs are collected.
    // Once both known: skip to step 6 for old cars (5+ years), else advance to step 5.
    // Don't advance from step 1 if the customer only sent a greeting (not a real name)
    const stayAtStep1        = currentStep === 1 && GREETING_ONLY.test(messageText);
    // Don't advance from step 4 until both mileage AND specs are collected
    const stayAtMileageSpecs = currentStep === 4 && !hasAllVehicleFields;
    // Don't advance from step 5 if loan=yes but amount not yet collected
    const stayAtLoanAmount   = currentStep === 5 && loanIsYes
      && !mortgageAmount && !conversation.mortgage_amount;
    // Don't advance from step 8 until the LLM has sent the booking confirmation
    const stayAtAppointment  = currentStep === FINAL_STEP && !appointmentConfirmed;
    const nextStep = currentStep >= CLOSING_STEP ? CLOSING_STEP
      : stayAtStep1        ? 1
      : stayAtMileageSpecs ? 4
      : stayAtLoanAmount   ? 5
      : stayAtAppointment  ? FINAL_STEP
      : currentStep === 1 && isUAE ? 3  // UAE senders skip the UAE-phone step
      : skipLoan           ? 6
      : currentStep + 1;
    coreUpdates.step = nextStep;
    const updatedConversation = await updateConversation(phone, coreUpdates);

    // ── Persist vehicle fields (best-effort — columns may not exist yet) ──
    if (Object.keys(vehicleUpdates).length > 0) {
      try {
        await updateConversation(phone, vehicleUpdates as Partial<Conversation>);
      } catch (e) {
        console.error("vehicleUpdates save error (non-fatal):", e);
      }
    }

    // ── Save estimated price when valuation is available ─────────────
    if (valuation?.formatted) {
      try {
        await updateConversation(phone, { estimated_price: valuation.formatted } as any);
      } catch (e) {
        console.error("estimated_price save error (non-fatal):", e);
      }
    }

    // ── Save mortgage amount if extracted ─────────────────────────────
    if (mortgageAmount) {
      try {
        await updateConversation(phone, { mortgage_amount: mortgageAmount });
      } catch (e) {
        console.error("mortgageAmount save error (non-fatal):", e);
      }
    }

    // Appointment date/time is extracted early (before the LLM call) — no second pass needed.

    if (currentStep === FINAL_STEP && appointmentConfirmed) {
      // Re-fetch latest state so Bigin gets all extracted fields
      const { getConversation } = await import("@/lib/supabase");
      const latestConv = await getConversation(phone);
      await createBiginContact((latestConv ?? updatedConversation) as Conversation);
      // Mark as pushed so the inactivity cron doesn't create a duplicate
      try {
        await updateConversation(phone, { bigin_pushed_at: new Date().toISOString() } as any);
      } catch (e) {
        console.error("bigin_pushed_at save error (non-fatal):", e);
      }
    }

    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch (error) {
    console.error("Webhook POST error:", error);
    return NextResponse.json({ status: "error" }, { status: 200 });
  }
}
