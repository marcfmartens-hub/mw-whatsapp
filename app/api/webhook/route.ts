import { NextRequest, NextResponse } from "next/server";
import { getOrCreateConversation, updateConversation, resetConversation, Conversation } from "@/lib/supabase";
import { getKayaReply, extractVehicleInfo, extractAppointment, VehicleFields } from "@/lib/claude";
import { sendWhatsAppMessage } from "@/lib/meta";
import { createBiginContact } from "@/lib/bigin";

export const dynamic = "force-dynamic";

const RESET_KEYWORD = "reset chat 007";

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
  2: "car",              // customer states intent / car info
  3: undefined,          // mileage+specs collected via vehicle extraction only
  4: "loan",             // loan status (skipped for cars 5+ years old)
  5: undefined,          // summary confirmation — no field to save
  6: "sell_timeline",    // when do they want to sell?
  7: "appointment",      // appointment day/time — Bigin fires after this
};

const FINAL_STEP  = 7;
const CLOSING_STEP = 8;

const URGENT_KEYWORDS  = /\b(today|now|right now|asap|any\s*time|whenever|when the price is right|immediately|urgent)\b/i;
const GREETING_ONLY   = /^(hi+|hey+|hello+|hiya|yo|howdy|good\s*(morning|afternoon|evening|day|evening))[\s!.,]*$/i;

function getDubaiHour(): number {
  return new Date(Date.now() + 4 * 60 * 60 * 1000).getUTCHours();
}

// Typed action tokens — set by webhook logic, consumed by buildDirectResponse.
// Using a discriminated union avoids fragile substring matching.
type NextAction =
  | { type: "ASK_NAME" }
  | { type: "ASK_CAR_DETAILS" }
  | { type: "ASK_MILEAGE_SPECS" }
  | { type: "ASK_SPECS" }
  | { type: "ASK_MORTGAGE" }
  | { type: "ASK_AMOUNT" }
  | { type: "CLARIFY_MODEL" }
  | { type: "SHOW_SUMMARY" }
  | { type: "CONFIRM_TYPO"; suggestion: string };

// Human-readable version sent to the LLM (for nuanced fallback cases)
function describeAction(a: NextAction): string {
  switch (a.type) {
    case "ASK_NAME":         return `Reply with exactly: "And what's your name? 😊"`;
    case "ASK_CAR_DETAILS":  return "Ask for the car make, model and year.";
    case "ASK_MILEAGE_SPECS":return "Ask for BOTH the mileage AND whether the car is GCC or non-GCC specs — in one question.";
    case "ASK_SPECS":        return `Ask ONLY: "Is it GCC or non-GCC specs?"`;
    case "ASK_MORTGAGE":     return `Ask: "Is there any outstanding mortgage on the car?"`;
    case "ASK_AMOUNT":       return `Ask: "How much is the outstanding balance?"`;
    case "CLARIFY_MODEL":    return "Ask the customer to confirm or clarify the car model and year.";
    case "SHOW_SUMMARY":     return `Show the car summary (plain, no emojis) and ask "Does that look correct?"`;
    case "CONFIRM_TYPO":     return `Confirm typo — ask: "Just to confirm — did you mean ${a.suggestion}? 😊" Do not ask for mileage yet.`;
  }
}

// Build the reply directly from the action token — no LLM needed for these cases.
function buildDirectResponse(
  action: NextAction,
  name: string | null | undefined,
  known: { make?: string | null; model?: string | null; year?: string | null;
           mileage?: string | null; specs?: string | null }
): string {
  const n = name ? `, ${name}` : "";
  switch (action.type) {
    case "ASK_NAME":
      return "And what's your name? 😊";
    case "ASK_CAR_DETAILS":
      return `Sure${n}, I can help! 😊 Could you share the make, model and year of your car?`;
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
    case "CONFIRM_TYPO":
      return `Just to confirm${n} — did you mean ${action.suggestion}? 😊`;
    case "SHOW_SUMMARY": {
      const make    = known.make    || "Unknown";
      const model   = known.model   || "Unknown";
      const year    = known.year    || "Unknown";
      const mileage = known.mileage ? `${known.mileage} km` : "Unknown";
      const specs   = known.specs   || "Unknown";
      return `Here's a summary of your car:\n\nMake: ${make}\nModel: ${model}\nYear: ${year}\nMileage: ${mileage}\nSpecs: ${specs}\n\nDoes that look correct?`;
    }
  }
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
  type: string;
}

function extractMessage(body: any): IncomingMessage | null {
  try {
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    if (!value?.messages || value.messages.length === 0) return null;
    const message = value.messages[0];
    return { from: message.from, id: message.id, text: message.text, type: message.type };
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

    const phone = message.from;
    const messageText = message.text?.body?.trim() ?? "";

    // ── Reset trigger ──────────────────────────────────────────────
    if (messageText.toLowerCase() === RESET_KEYWORD) {
      await resetConversation(phone);
      // step stays at 0 — greeting fires on next message
      return NextResponse.json({ status: "reset" }, { status: 200 });
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
    const coreUpdates: Partial<Conversation> = { last_msg_id: message.id };
    if (fieldToSave && messageText) {
      // Don't overwrite an already-saved loan answer with a mortgage amount follow-up
      const isLoanAmountFollowUp = fieldToSave === "loan" && !!conversation.loan;
      if (!isLoanAmountFollowUp) {
        (coreUpdates as any)[fieldToSave] = messageText;
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

    // ── Explicit "I don't know specs" detection ────────────────────
    // If at step 3, specs not yet known, and customer expresses uncertainty → record Unknown
    const SPECS_UNSURE = /\b(i\s*don'?t\s*know|not\s*sure|no\s*idea|unsure|idk|not\s*sure\s*about|unclear)\b/i;
    const hasKnownSpecs = (vehicleUpdates.specs && vehicleUpdates.specs !== "Unknown")
                          || (conversation.specs && conversation.specs !== "Unknown");
    const specsExplicitlyUnknown = currentStep === 3 && !hasKnownSpecs && SPECS_UNSURE.test(messageText);
    if (specsExplicitlyUnknown) vehicleUpdates.specs = "Unknown";

    // ── Build knownFields for Kaya's system prompt ─────────────────
    // At step 5 (sell timeline answer), detect urgency and pass Dubai hour
    const sellTimeline = fieldToSave === "sell_timeline" ? messageText : (conversation.sell_timeline ?? undefined);
    const sellUrgent   = sellTimeline ? URGENT_KEYWORDS.test(sellTimeline) : undefined;
    // ── Mortgage amount extraction ─────────────────────────────────
    // Runs at step 4 whether the customer says "yes 50k" in one go,
    // or says "yes" first and provides the amount as a follow-up.
    let mortgageAmount: string | undefined;
    const loanAnswer = fieldToSave === "loan" ? messageText : (conversation.loan ?? "");
    const loanIsYes  = /\byes\b|\bdo\b|have a|there is|outstanding/i.test(loanAnswer);
    if (currentStep === 4 && loanIsYes && messageText) {
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
    // All vehicle fields must be present before leaving step 3.
    // specsExplicitlyUnknown counts as "answered" so the flow continues.
    const hasAllVehicleFields = !!carMileage && (!!carSpecs || specsExplicitlyUnknown
                                  || conversation.specs === "Unknown");
    // Skip mortgage for cars 5+ years old (only once mileage+specs are collected)
    const skipLoan = currentStep === 3 && hasAllVehicleFields && carYear > 0 && (currentYear - carYear) >= 5;

    // ── Compute next_action for steps 2–4 so the model executes one clear directive ──
    // The webhook evaluates all conditions; the model just phrases the result naturally.
    const hasTypo  = Array.isArray(vehicleUpdates.typo_check) && vehicleUpdates.typo_check.length > 0;
    const hasModel = !!(vehicleUpdates.make ?? conversation.make) && !!(
      (vehicleUpdates.model && vehicleUpdates.model !== "Unknown") ||
      (conversation.model   && conversation.model   !== "Unknown")
    );
    const hasYear  = !!(vehicleUpdates.year ?? conversation.year);
    const hasSpecs = !!carSpecs || specsExplicitlyUnknown || conversation.specs === "Unknown";

    let action: NextAction | undefined;

    if (currentStep === 1 && GREETING_ONLY.test(messageText)) {
      action = { type: "ASK_NAME" };
    } else if (currentStep === 2) {
      if (hasTypo) {
        action = { type: "CONFIRM_TYPO", suggestion: vehicleUpdates.typo_check![0].suggestion };
      } else if (!hasModel || !hasYear) {
        action = { type: "ASK_CAR_DETAILS" };
      } else {
        action = { type: "ASK_MILEAGE_SPECS" };
      }
    } else if (currentStep === 3) {
      if (hasTypo) {
        action = { type: "CONFIRM_TYPO", suggestion: vehicleUpdates.typo_check![0].suggestion };
      } else if (!hasModel || !hasYear) {
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
    } else if (currentStep === 4 && loanIsYes && !mortgageAmount && !conversation.mortgage_amount) {
      action = { type: "ASK_AMOUNT" };
    }

    const knownFields = {
      ...conversation,
      ...coreUpdates,
      ...vehicleUpdates,
      sell_timeline:   sellTimeline,
      sell_urgent:     sellUrgent,
      dubai_hour:      getDubaiHour(),
      dubai_datetime:  getDubaiDateTime(),
      mortgage_amount: mortgageAmount ?? conversation.mortgage_amount,
      skip_mortgage:   hasAllVehicleFields && carYear > 0 && (currentYear - carYear) >= 5,
      next_action:     action ? describeAction(action) : undefined,
    };

    console.log(`[kaya] step=${currentStep} action=${action?.type ?? "none"}`);

    // Steps with a typed action always get a direct template response — zero LLM hallucination risk.
    // Steps without an action (5, 6, 7, 8) go to the LLM for nuanced handling.
    const reply = action
      ? buildDirectResponse(action, conversation.name, knownFields)
      : await getKayaReply(currentStep, [], messageText, knownFields);

    await sendWhatsAppMessage(phone, reply);

    // ── Persist core update + advance step ─────────────────────────
    // Stay at step 3 until BOTH mileage and specs are collected.
    // Once both known: skip to step 5 for old cars (5+ years), else advance to step 4.
    // Don't advance from step 1 if the customer only sent a greeting (not a real name)
    const stayAtStep1 = currentStep === 1 && GREETING_ONLY.test(messageText);
    // Don't advance from step 3 until both mileage AND specs are collected
    const stayAtStep3 = currentStep === 3 && !hasAllVehicleFields;
    // Don't advance from step 4 if loan=yes but amount not yet collected
    const stayAtStep4 = currentStep === 4 && loanIsYes
      && !mortgageAmount && !conversation.mortgage_amount;
    const nextStep = currentStep >= CLOSING_STEP ? CLOSING_STEP
      : stayAtStep1 ? 1
      : stayAtStep3 ? 3
      : stayAtStep4 ? 4
      : skipLoan    ? 5
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

    // ── Save mortgage amount if extracted ─────────────────────────────
    if (mortgageAmount) {
      try {
        await updateConversation(phone, { mortgage_amount: mortgageAmount });
      } catch (e) {
        console.error("mortgageAmount save error (non-fatal):", e);
      }
    }

    // ── Appointment date/time extraction (step 7 = appointment answer) ──
    if (fieldToSave === "appointment" && messageText) {
      try {
        const appt = await extractAppointment(messageText);
        const apptUpdates: Partial<Conversation> = {};
        if (appt.appointment_date) apptUpdates.appointment_date = appt.appointment_date;
        if (appt.appointment_time) apptUpdates.appointment_time = appt.appointment_time;
        if (Object.keys(apptUpdates).length > 0) {
          await updateConversation(phone, apptUpdates);
        }
      } catch (e) {
        console.error("appointmentUpdates save error (non-fatal):", e);
      }
    }

    if (currentStep === FINAL_STEP) {
      // Re-fetch latest state so Bigin gets all extracted fields (make/model/year/specs/appointment_date/appointment_time)
      const { getConversation } = await import("@/lib/supabase");
      const latestConv = await getConversation(phone);
      await createBiginContact((latestConv ?? updatedConversation) as Conversation);
    }

    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch (error) {
    console.error("Webhook POST error:", error);
    return NextResponse.json({ status: "error" }, { status: 200 });
  }
}
