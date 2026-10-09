import { NextRequest, NextResponse } from "next/server";
import { getOrCreateConversation, updateConversation, resetConversation, getConversation, Conversation } from "@/lib/supabase";
import { getKayaReply, extractVehicleInfo, extractAppointment, generateInquirySummary, VehicleFields, ConversationMessage } from "@/lib/claude";
import { sendWhatsAppMessage, sendWhatsAppImage } from "@/lib/meta";
import { createBiginContact } from "@/lib/bigin";
import { CAR_MODELS } from "@/lib/carData";
import { estimateCarValue } from "@/lib/valuation";

export const dynamic = "force-dynamic";

const RESET_KEYWORD = "reset chat 007";

const LOCATION_KEYWORDS = /\b(location|address|where are you|where is|how to get|directions?|map|find you|your office|office location|come to you)\b/i;

const LOCATION_IMAGE_URL = "https://mw-whatsapp2.vercel.app/location.jpg";

const LOCATION_TEXT = `📍 Mister Wheelz Car Buyers\n\n409 Sheikh Zayed Rd\nF1rst Motors Bldg.\n1st Floor, Office 7\nAl Quoz First - Dubai\n\nEntrance - Left side of the Building\n\nhttps://maps.app.goo.gl/4L7EkwGZfnffofuh8`;

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
  2: "car",              // customer states car info (phone always auto-saved from sender)
  3: "car",              // car info (UAE skip phone step → goes straight here)
  4: undefined,          // mileage+specs collected via vehicle extraction only
  5: "loan",             // loan / mortgage status
  6: "sell_timeline",    // sell method: cash / consignment / not sure
  7: "appointment",      // appointment day/time — Bigin fires after this
};

const FINAL_STEP  = 7;
const CLOSING_STEP = 8;

// Sell method detection
const SELL_METHOD_CASH        = /\b(cash|direct|buy now|sell now|sell fast|quick sale|immediately|instant)\b/i;
const SELL_METHOD_CONSIGNMENT = /\b(consign|consignment|list|listing|display|market|higher price|best price)\b/i;
const SELL_METHOD_NOT_SURE    = /\b(not sure|unsure|don.?t know|undecided|still deciding|what.?s better|which is better|explain|difference|options?)\b/i;

// Handoff detection — complex conversations that need a human
const HANDOFF_SIGNALS = /\b(too many questions|complicated|confused|call me|speak to someone|talk to a person|human|agent|manager|more information|tell me more|how does it work|what happens|walk me through|i don.?t understand)\b/i;

// Special inquiry types
const HOME_VISIT_PATTERN  = /\b(home\s*(visit|pick\s*up|collection|pickup)|come\s*to\s*(me|my|us)|pick\s*(it\s*)?up|collect\s*(from|at)|i\s*can.?t\s*(come|bring)|unable\s*to\s*(come|drive|bring)|mobility|wheelchair|disabled)\b/i;
const TRADE_IN_PATTERN    = /\b(trade[\s-]?in|trade\s*my|swap|exchange|part[\s-]?exchange|replace\s*(my|the)|get\s*(a\s*)?new\s*car|upgrade\s*(my|the)|in\s*exchange\s*for)\b/i;
const PRICE_OFFER_PATTERN = /\b(how\s*much|price|offer|estimate|valuation|value|worth|what\s*(will\s*you\s*pay|do\s*you\s*give|can\s*i\s*get)|give\s*me\s*(a\s*)?(price|number|figure|quote))\b/i;

// Ownership detection
const OWNER_PATTERN = /\b(my\s*car|i\s*(own|am\s*the\s*owner)|registered\s*(in\s*my\s*name|owner)|it.?s\s*mine)\b/i;
const POA_PATTERN   = /\b(poa|power\s*of\s*attorney|selling\s*for|on\s*behalf|not\s*my\s*car|friend.?s\s*car|family.?s\s*car|brother.?s|sister.?s|father.?s|mother.?s|husband.?s|wife.?s)\b/i;

// Car condition signals — extract when mentioned
const CONDITION_PATTERN = /\b(accident|damage|damaged|dent|scratch|flood|fire|total\s*loss|write[\s-]?off|modified|modification|tuned|engine|gearbox|transmission|service|fine|fines|traffic\s*fine|salik|document|registration|mulkiya|expired|missing|lost|stolen|bank\s*loan|finance|mortgage)\b/i;

// Insult detection
const INSULT_PATTERN = /\b(stupid|idiot|dumb|useless|moron|asshole|ass hole|bastard|bitch|fuck|shit|scam|fraud|liar|pathetic|garbage|rubbish|trash|waste of time|terrible|horrible|disgusting)\b/i;

const URGENT_KEYWORDS  = /\b(today|now|right now|asap|any\s*time|whenever|when the price is right|immediately|urgent)\b/i;
const GREETING_ONLY   = /^(hi+|hey+|hello+|hiya|yo|howdy|good\s*(morning|afternoon|evening|day|evening))[\s!.,]*$/i;

function getDubaiHour(): number {
  return new Date(Date.now() + 4 * 60 * 60 * 1000).getUTCHours();
}

function getDubaiTomorrow(): string {
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

function extractNameFromMessage(text: string): string | null {
  const m = text.match(
    /(?:i'?m\s+|i\s+am\s+|my\s+name(?:\s+is)?\s+|it'?s\s+|this\s+is\s+|name\s+is\s+|call\s+me\s+)([A-Za-z][a-z]*(?:\s+[A-Za-z][a-z]*)?)/i
  );
  if (m) return m[1].trim().replace(/\b\w/g, (c) => c.toUpperCase());
  const trimmed = text.trim();
  if (/^[A-Za-z]+(?:\s+[A-Za-z]+)?$/.test(trimmed) && trimmed.length <= 30)
    return trimmed.replace(/\b\w/g, (c) => c.toUpperCase());
  return null;
}

function quickModelMatch(text: string, make: string): string | undefined {
  const models = CAR_MODELS[make];
  if (!models) return undefined;
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
    const messageText = message.text?.body?.trim() ?? message.image?.caption?.trim() ?? "";

    // ── Reset trigger ──────────────────────────────────────────────
    if (messageText.toLowerCase() === RESET_KEYWORD) {
      await resetConversation(phone);
      const reply = await getKayaReply(0, [], "", {});
      await sendWhatsAppMessage(phone, reply);
      return NextResponse.json({ status: "reset" }, { status: 200 });
    }
    // ──────────────────────────────────────────────────────────────

    // ── Location trigger ───────────────────────────────────────────
    const isLocationMessage = message.type === "location";
    const isLocationRequest = LOCATION_KEYWORDS.test(messageText);
    if (isLocationMessage || isLocationRequest) {
      await sendWhatsAppImage(phone, LOCATION_IMAGE_URL);
      await sendWhatsAppMessage(phone, LOCATION_TEXT);
      const convForLocation = await getOrCreateConversation(phone);
      if ((convForLocation.step ?? 0) >= FINAL_STEP - 1) {
        await sendWhatsAppMessage(phone, "What time works best for you to bring the car in?");
      }
      return NextResponse.json({ status: "location_sent" }, { status: 200 });
    }
    // ──────────────────────────────────────────────────────────────

    const conversation = await getOrCreateConversation(phone);

    // Always save the sender's phone number — no need to ask for it
    if (!conversation.phone_number) {
      await updateConversation(phone, { phone_number: phone });
      conversation.phone_number = phone;
    }

    // Insult detection — track count and close after second insult
    if (INSULT_PATTERN.test(messageText)) {
      const insultCount = ((conversation as any).insult_count ?? 0) + 1;
      await updateConversation(phone, { insult_count: insultCount } as any);
      if (insultCount >= 2) {
        // Second insult — close conversation and hand off
        await sendWhatsAppMessage(phone, "I'm going to pass you on to one of our team members who can assist you better. Take care.");
        try { await createBiginContact({ ...conversation, phone_number: phone } as any); } catch (_) {}
        return NextResponse.json({ status: "closed_insult" }, { status: 200 });
      } else {
        // First insult — respond with empathy
        await sendWhatsAppMessage(phone, "I understand, we all have frustrating moments sometimes. I'm here to help whenever you're ready.");
        return NextResponse.json({ status: "insult_warned" }, { status: 200 });
      }
    }

    if (conversation.last_msg_id && conversation.last_msg_id === message.id) {
      return NextResponse.json({ status: "duplicate" }, { status: 200 });
    }

    // ── Special inquiry detection (any step) ──────────────────────────────
    // Home visit or trade-in inquiry → collect info, push to Bigin, hand off
    const isHomeVisit = HOME_VISIT_PATTERN.test(messageText);
    const isTradeIn   = TRADE_IN_PATTERN.test(messageText);
    if ((isHomeVisit || isTradeIn) && (conversation.step ?? 0) > 0) {
      const inquiryType = isHomeVisit ? "Home Visit Inquiry" : "Trade-in Inquiry";
      const inquiryTag  = isHomeVisit ? "home_visit" : "trade_in";
      await updateConversation(phone, { sell_timeline: `sell_method:${inquiryTag}` } as any);
      const replyMsg = isHomeVisit
        ? "Of course, we can look into that for you. Let me pass your details to our team and they'll be in touch with you shortly to arrange."
        : "Happy to discuss that. Let me pass your details to our team and they'll reach out to you shortly to go over the options.";
      await sendWhatsAppMessage(phone, replyMsg);
      // Don't push to Bigin immediately — cron will pick up after 12 min silence
      // or the goodbye detection below will fire if they reply and say goodbye
      return NextResponse.json({ status: "special_inquiry" }, { status: 200 });
    }
    // ─────────────────────────────────────────────────────────────────────

    const currentStep = conversation.step ?? 0;
    const fieldToSave = FIELD_BY_STEP[currentStep];

    const coreUpdates: Partial<Conversation> = {
      last_msg_id: message.id,
      last_message_at: new Date().toISOString(),
    };
    if (fieldToSave && messageText) {
      const isLoanAmountFollowUp = fieldToSave === "loan" && !!conversation.loan;
      const isGreetingOnly = fieldToSave === "name" && GREETING_ONLY.test(messageText);
      if (!isLoanAmountFollowUp && !isGreetingOnly) {
        const valueToSave = fieldToSave === "name"
          ? extractNameFromMessage(messageText)
          : messageText;
        if (valueToSave !== null) {
          (coreUpdates as any)[fieldToSave] = valueToSave;
        }
      }
    }

    const alreadyKnown: VehicleFields = {
      make:    (conversation.make    && conversation.make    !== "Unknown") ? conversation.make    : undefined,
      model:   (conversation.model   && conversation.model   !== "Unknown") ? conversation.model   : undefined,
      year:    conversation.year    ?? undefined,
      mileage: conversation.mileage ?? undefined,
      specs:   conversation.specs   ?? undefined,
    };
    const vehicleUpdates = await extractVehicleInfo(messageText, alreadyKnown);

    if (!vehicleUpdates.model || vehicleUpdates.model === "Unknown") {
      const effectiveMake = vehicleUpdates.make ?? conversation.make;
      if (effectiveMake && effectiveMake !== "Unknown") {
        const found = quickModelMatch(messageText, effectiveMake);
        if (found) {
          vehicleUpdates.model = found;
          if (vehicleUpdates.typo_check) {
            vehicleUpdates.typo_check = vehicleUpdates.typo_check.filter(
              (t) => t.field !== "model"
            );
            if (vehicleUpdates.typo_check.length === 0) delete vehicleUpdates.typo_check;
          }
        }
      }
    }

    if (alreadyKnown.mileage && vehicleUpdates.mileage) delete vehicleUpdates.mileage;
    if (alreadyKnown.specs   && vehicleUpdates.specs)   delete vehicleUpdates.specs;

    // Ownership detection — save once, don't overwrite
    if (!conversation.owner_status) {
      if (POA_PATTERN.test(messageText))   await updateConversation(phone, { owner_status: "POA" } as any).catch(() => {});
      else if (OWNER_PATTERN.test(messageText)) await updateConversation(phone, { owner_status: "Owner" } as any).catch(() => {});
    }

    // Car conditions — append any new condition signals mentioned
    if (CONDITION_PATTERN.test(messageText)) {
      const existing = (conversation as any).car_conditions ?? "";
      const newCondition = messageText.trim();
      const updated = existing ? `${existing} | ${newCondition}` : newCondition;
      await updateConversation(phone, { car_conditions: updated } as any).catch(() => {});
    }

    const SPECS_UNSURE = /\b(i\s*don'?t\s*know|not\s*sure|no\s*idea|unsure|idk|not\s*sure\s*about|unclear)\b/i;
    const hasKnownSpecs = (vehicleUpdates.specs && vehicleUpdates.specs !== "Unknown")
                          || (conversation.specs && conversation.specs !== "Unknown");
    const specsExplicitlyUnknown = currentStep === 4 && !hasKnownSpecs && SPECS_UNSURE.test(messageText);
    if (specsExplicitlyUnknown) vehicleUpdates.specs = "Unknown";

    let apptDate = conversation.appointment_date ?? "";
    let apptTime = conversation.appointment_time ?? "";
    let altPhone: string | undefined;

    if (currentStep === FINAL_STEP && messageText) {
      try {
        const ea = await extractAppointment(messageText);
        if (ea.appointment_date) apptDate = ea.appointment_date;
        if (ea.appointment_time) apptTime  = ea.appointment_time;
        const apptSave: Partial<Conversation> = {};
        if (ea.appointment_date) apptSave.appointment_date = ea.appointment_date;
        if (ea.appointment_time) apptSave.appointment_time  = ea.appointment_time;
        if (Object.keys(apptSave).length > 0)
          await updateConversation(phone, apptSave);
      } catch (e) {
        console.error("early appointment extraction error:", e);
      }

      // Capture alternative phone number if customer provides one at booking step
      const phoneMatch = messageText.match(/(?:\+?971|0)?[5][0-9]\d{7}/);
      if (phoneMatch) {
        const rawPhone = phoneMatch[0].replace(/\D/g, "");
        const normalised = rawPhone.startsWith("971") ? rawPhone : `971${rawPhone.replace(/^0/, "")}`;
        if (normalised !== phone) {
          altPhone = normalised;
          try { await updateConversation(phone, { alternative_phone: altPhone } as any); } catch (_) {}
        }
      }
    }

    // Track price-offer-only leads (pushed before price, then drops off)
    const isPriceOnlySignal = PRICE_OFFER_PATTERN.test(messageText) && currentStep <= 3;

    const sellTimeline = fieldToSave === "sell_timeline" ? messageText : (conversation.sell_timeline ?? undefined);
    const sellUrgent   = sellTimeline ? URGENT_KEYWORDS.test(sellTimeline) : undefined;

    let mortgageAmount: string | undefined;
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
    const hasAllVehicleFields = !!carMileage && (!!carSpecs || specsExplicitlyUnknown
                                  || conversation.specs === "Unknown");
    const skipLoan = currentStep === 4 && hasAllVehicleFields && carYear > 0 && (currentYear - carYear) >= 10;

    // ── Non-GCC / imported specs redirect ─────────────────────────────────────
    // When specs are confirmed as Non-GCC, skip appointment booking and hand off
    // to the purchase team. Collect remaining info then push to Bigin.
    const isNonGcc = carSpecs === "Non-GCC";
    const alreadyHandedOff = (conversation as any).non_gcc_handoff === true;
    if (isNonGcc && !alreadyHandedOff && currentStep >= 4) {
      // Save the non_gcc_handoff flag so this only fires once
      await updateConversation(phone, { non_gcc_handoff: true } as any).catch(() => {});

      // Check if we still need name / remaining vehicle info
      const missingInfo: string[] = [];
      const resolvedMake    = vehicleUpdates.make    ?? conversation.make;
      const resolvedModel   = vehicleUpdates.model   ?? conversation.model;
      const resolvedYear    = vehicleUpdates.year    ?? conversation.year;
      const resolvedMileage = vehicleUpdates.mileage ?? conversation.mileage;
      if (!resolvedMake)    missingInfo.push("make");
      if (!resolvedModel)   missingInfo.push("model");
      if (!resolvedYear)    missingInfo.push("year");
      if (!resolvedMileage) missingInfo.push("mileage");

      const nextQ = missingInfo.length > 0
        ? `Could you also share the ${missingInfo[0]} of the car?`
        : !conversation.name
          ? "And may I know your name?"
          : null;

      const handoffMsg = nextQ
        ? `Thanks for letting me know. Whether we can buy non-GCC cars depends on the specific car and its condition — it's not a standard process for us. I'll have someone from our purchasing team reach out to you directly to discuss this. ${nextQ}`
        : `Thanks for letting me know. Whether we can buy non-GCC cars depends on the specific car and its condition. I'll have someone from our purchasing team reach out to you directly. Thanks, I've got everything I need — our team will be in touch shortly.`;

      await sendWhatsAppMessage(phone, handoffMsg);
      // Don't push to Bigin immediately — cron picks up after 12 min silence
      return NextResponse.json({ status: "non_gcc_handoff" }, { status: 200 });
    }

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
      vehicleUpdates.typo_check = [];
    }

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
      action = { type: "SHOW_FULL_SUMMARY" };
    }

    const history: ConversationMessage[] = (conversation.messages ?? []) as ConversationMessage[];
    const PRICE_PUSH      = /\b(price|offer|estimate|range|how much|what.*(worth|pay|give)|give me.*price|tell me.*price)\b/i;
    const HUMAN_REQUEST   = /\b(speak to|talk to|call me|speak with|agent|human|person|manager|someone from|real person|staff)\b/i;
    const BOOKING_REFUSAL = /\b(no[,.]?\s*(thanks|thank you|i|i'll)?|not\s*(now|yet|today|ready|going)|i'?ll\s*(think|let you|pass)|maybe later|don'?t\s*want|not\s*interested)\b/i;
    const OPTIONS_SENT = /consignment|direct cash sale|we can advise after/i;
    const alreadyExplainedOptions = history.some(
      m => m.role === "assistant" && OPTIONS_SENT.test(m.content)
    );

    // Save sell method at step 6
    if (currentStep === 6 && messageText) {
      let sellMethod: string | undefined;
      if (SELL_METHOD_CASH.test(messageText))        sellMethod = "cash";
      else if (SELL_METHOD_CONSIGNMENT.test(messageText)) sellMethod = "consignment";
      else if (SELL_METHOD_NOT_SURE.test(messageText))    sellMethod = "not_sure";
      if (sellMethod) {
        try {
          await updateConversation(phone, { sell_timeline: `sell_method:${sellMethod}` } as any);
        } catch (e) {
          console.error("sell method save error (non-fatal):", e);
        }
      }
    }

    // Handoff trigger — complex conversations get forwarded to purchase team
    const handoffSignal =
      HUMAN_REQUEST.test(messageText) ||
      (currentStep >= 6 && HANDOFF_SIGNALS.test(messageText)) ||
      (alreadyExplainedOptions && PRICE_PUSH.test(messageText)) ||
      (alreadyExplainedOptions && BOOKING_REFUSAL.test(messageText));

    const callbackSignal = handoffSignal;
    if (!action && currentStep >= 5 && currentStep < CLOSING_STEP && callbackSignal) {
      action = { type: "OFFER_CALLBACK" };
    }

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
      appointment_date: apptDate || conversation.appointment_date || undefined,
      appointment_time: apptTime || conversation.appointment_time || undefined,
    };

    console.log(`[kaya] step=${currentStep} action=${action?.type ?? "none"}`);

    const reply = action
      ? buildDirectResponse(action, (knownFields.name ?? conversation.name) as string | null, knownFields)
      : await getKayaReply(currentStep, history, messageText, knownFields);

    const appointmentConfirmedEarly = currentStep === FINAL_STEP && !action &&
      /team will be in touch on whatsapp/i.test(reply);

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

    if (action?.type === "OFFER_CALLBACK") {
      await sendWhatsAppMessage(phone, "Our purchase team will be in touch with you shortly. You're also welcome to walk in whenever — here's where to find us.");
      await sendWhatsAppImage(phone, LOCATION_IMAGE_URL);
      await sendWhatsAppMessage(phone, LOCATION_TEXT);
      // Don't push to Bigin immediately — push after goodbye or cron after 12 min silence
    }

    // Price handoff goodbye detection — push after full details collected and goodbye sent
    const isPriceHandoffReady      = (conversation as any).price_handoff_ready === true;
    const isPriceHandoffCollecting = (conversation as any).price_handoff_collecting === true;
    const priceHandoffGoodbye      = /have a nice day|team will be in touch|our team will be in touch/i.test(reply);
    if ((isPriceHandoffReady || isPriceHandoffCollecting) && priceHandoffGoodbye && !conversation.bigin_pushed_at) {
      try {
        const latestConv = await getConversation(phone);
        const latestHistory: ConversationMessage[] = Array.isArray(latestConv?.messages) ? latestConv.messages : [];
        const inquirySummary = await generateInquirySummary(latestHistory, knownFields).catch(() => "");
        await createBiginContact({
          ...(latestConv ?? conversation),
          phone_number: phone,
          sales_inquiry: "Price Offer Inquiry",
          inspection_booked: false,
          inquiry_summary: inquirySummary,
          owner_status: (latestConv as any)?.owner_status ?? (conversation as any).owner_status,
          car_conditions: (latestConv as any)?.car_conditions ?? (conversation as any).car_conditions,
        } as any);
        await updateConversation(phone, { bigin_pushed_at: new Date().toISOString() } as any);
        console.log("[webhook] price handoff goodbye detected — pushed to Bigin");
      } catch (e) {
        console.error("price handoff Bigin push error (non-fatal):", e);
      }
    }

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

    const appointmentConfirmed = appointmentConfirmedEarly;

    const stayAtStep1        = currentStep === 1 && GREETING_ONLY.test(messageText);
    const stayAtMileageSpecs = currentStep === 4 && !hasAllVehicleFields;
    const stayAtLoanAmount   = currentStep === 5 && loanIsYes
      && !mortgageAmount && !conversation.mortgage_amount;
    const stayAtAppointment  = currentStep === FINAL_STEP && !appointmentConfirmed;
    // At step 6 (sell method), only stay if they asked for explanation (not sure / explain)
    // — otherwise advance to appointment booking
    const stayAtSellMethod   = currentStep === 6 && SELL_METHOD_NOT_SURE.test(messageText)
      && !SELL_METHOD_CASH.test(messageText) && !SELL_METHOD_CONSIGNMENT.test(messageText);
    const nextStep = currentStep >= CLOSING_STEP ? CLOSING_STEP
      : stayAtStep1        ? 1
      : stayAtMileageSpecs ? 4
      : stayAtLoanAmount   ? 5
      : stayAtSellMethod   ? 6
      : stayAtAppointment  ? FINAL_STEP
      : skipLoan           ? 6
      : currentStep + 1;
    coreUpdates.step = nextStep;
    const updatedConversation = await updateConversation(phone, coreUpdates);

    if (Object.keys(vehicleUpdates).length > 0) {
      try {
        await updateConversation(phone, vehicleUpdates as Partial<Conversation>);
      } catch (e) {
        console.error("vehicleUpdates save error (non-fatal):", e);
      }
    }

    if (valuation?.formatted) {
      try {
        await updateConversation(phone, { estimated_price: valuation.formatted } as any);
      } catch (e) {
        console.error("estimated_price save error (non-fatal):", e);
      }
    }

    if (mortgageAmount) {
      try {
        await updateConversation(phone, { mortgage_amount: mortgageAmount });
      } catch (e) {
        console.error("mortgageAmount save error (non-fatal):", e);
      }
    }

    if (currentStep === FINAL_STEP && appointmentConfirmed) {
      const { getConversation } = await import("@/lib/supabase");
      const latestConv = await getConversation(phone);
      const sellTl = (latestConv ?? updatedConversation as any)?.sell_timeline ?? "";
      let salesInquiry = "Cash Deal";
      if (sellTl.includes("consignment")) salesInquiry = "Consignment";
      else if (sellTl.includes("not_sure")) salesInquiry = "Not Sure - Need Advise";
      const latestHistory = ((latestConv as any)?.messages ?? history) as ConversationMessage[];
      const inquirySummary = await generateInquirySummary(latestHistory, knownFields).catch(() => "");
      await createBiginContact({
        ...(latestConv ?? updatedConversation),
        phone_number: phone,
        alternative_phone: altPhone ?? (latestConv as any)?.alternative_phone,
        owner_status: (latestConv as any)?.owner_status,
        car_conditions: (latestConv as any)?.car_conditions,
        sales_inquiry: salesInquiry,
        inspection_booked: true,
        inquiry_summary: inquirySummary,
      } as any);
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
