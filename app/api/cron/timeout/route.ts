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

const LOCATION_IMAGE_URL = ""; // no location photo yet (old location.jpg never existed in /public)

const LOCATION_TEXT = `📍 Mister Wheelz Car Buyers

Umm Suqeim Branch
Al Quoz 4 - Dubai

https://maps.app.goo.gl/nv6Yy7uKqVCnkcVx6`;

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

// ─── Step definitions (new 3-touchpoint flow) ────────────────────────────────
// Step 0: Greeting + name
// Step 1: What car? → push for appointment as soon as make+model+year known
// Step 2: Book appointment day + time
// Step 3: UAE phone number → confirm booking → Bigin push
// Step 4: Closing (booking complete)

const FINAL_STEP   = 3; // step at which booking is confirmed + Bigin fires
const CLOSING_STEP = 4; // post-booking, no more logic

// ─── Passive data patterns (never hard gates — just save when mentioned) ─────
const SELL_METHOD_CASH        = /\b(cash|direct|buy now|sell now|sell fast|quick sale|immediately|instant)\b/i;
const SELL_METHOD_CONSIGNMENT = /\b(consign|consignment|list|listing|display|market|higher price|best price)\b/i;

// Price/selling push detection — track how many times they've pushed so we know when to hand off
const PRICE_PUSH_PATTERN = /\b(how\s*much|price|offer|estimate|range|valuation|value|worth|what.*(worth|pay|give)|give me.*price|tell me.*price|want to know|how does.*work|selling.*options?|consignment|direct.*sale|which.*better|what.*difference)\b/i;

// Special inquiry types
const HOME_VISIT_PATTERN  = /\b(home\s*(visit|pick\s*up|collection|pickup)|come\s*to\s*(me|my|us)|pick\s*(it\s*)?up|collect\s*(from|at)|i\s*can.?t\s*(come|bring)|unable\s*to\s*(come|drive|bring)|mobility|wheelchair|disabled)\b/i;
const TRADE_IN_PATTERN    = /\b(trade[\s-]?in|trade\s*my|swap|exchange|part[\s-]?exchange|replace\s*(my|the)|get\s*(a\s*)?new\s*car|upgrade\s*(my|the)|in\s*exchange\s*for)\b/i;

// Ownership & condition signals — capture passively at any step
const OWNER_PATTERN = /\b(my\s*car|i\s*(own|am\s*the\s*owner)|registered\s*(in\s*my\s*name|owner)|it.?s\s*mine)\b/i;
const POA_PATTERN   = /\b(poa|power\s*of\s*attorney|selling\s*for|on\s*behalf|not\s*my\s*car|friend.?s\s*car|family.?s\s*car|brother.?s|sister.?s|father.?s|mother.?s|husband.?s|wife.?s)\b/i;
const CONDITION_PATTERN = /\b(accident|damage|damaged|dent|scratch|flood|fire|total\s*loss|write[\s-]?off|modified|modification|tuned|engine|gearbox|transmission|service|fine|fines|traffic\s*fine|salik|document|registration|mulkiya|expired|missing|lost|stolen|bank\s*loan|finance|mortgage)\b/i;

// Human handoff request
const HUMAN_REQUEST = /\b(speak to|talk to|call me|speak with|agent|human|person|manager|someone from|real person|staff)\b/i;

// Insult detection
const INSULT_PATTERN = /\b(stupid|idiot|dumb|useless|moron|asshole|ass hole|bastard|bitch|fuck|shit|scam|fraud|liar|pathetic|garbage|rubbish|trash|waste of time|terrible|horrible|disgusting)\b/i;

const GREETING_ONLY = /^(hi+|hey+|hello+|hiya|yo|howdy|good\s*(morning|afternoon|evening|day|evening))[\s!.,]*$/i;

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Push lead to Bigin (fire-and-forget, non-fatal) ─────────────────────────
async function pushToBigin(
  conversation: any,
  phone: string,
  history: ConversationMessage[],
  knownFields: any,
  salesInquiry: string,
  inspectionBooked: boolean
): Promise<void> {
  try {
    const latestConv = await getConversation(phone);
    const latestHistory: ConversationMessage[] = Array.isArray(latestConv?.messages)
      ? latestConv.messages : history;
    const inquirySummary = await generateInquirySummary(latestHistory, knownFields).catch(() => "");
    await createBiginContact({
      ...(latestConv ?? conversation),
      phone_number: phone,
      sales_inquiry: salesInquiry,
      inspection_booked: inspectionBooked,
      inquiry_summary: inquirySummary,
      owner_status: (latestConv as any)?.owner_status ?? (conversation as any)?.owner_status,
      car_conditions: (latestConv as any)?.car_conditions ?? (conversation as any)?.car_conditions,
    } as any);
    await updateConversation(phone, { bigin_pushed_at: new Date().toISOString() } as any);
  } catch (e) {
    console.error("[pushToBigin] error:", e);
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
    const isImageMessage = message.type === "image";
    const messageText = message.text?.body?.trim() ?? message.image?.caption?.trim() ?? "";

    // ── Reset trigger ──────────────────────────────────────────────────────────
    if (messageText.toLowerCase() === RESET_KEYWORD) {
      await resetConversation(phone);
      const reply = await getKayaReply(0, [], "", {});
      await sendWhatsAppMessage(phone, reply);
      return NextResponse.json({ status: "reset" }, { status: 200 });
    }

    // ── Location trigger ───────────────────────────────────────────────────────
    const isLocationMessage = message.type === "location";
    const isLocationRequest = LOCATION_KEYWORDS.test(messageText);
    if (isLocationMessage || isLocationRequest) {
      if (LOCATION_IMAGE_URL) await sendWhatsAppImage(phone, LOCATION_IMAGE_URL);
      await sendWhatsAppMessage(phone, LOCATION_TEXT);
      const convForLocation = await getOrCreateConversation(phone);
      if ((convForLocation.step ?? 0) >= FINAL_STEP) {
        await sendWhatsAppMessage(phone, "What time works best for you to bring the car in?");
      }
      return NextResponse.json({ status: "location_sent" }, { status: 200 });
    }

    const conversation = await getOrCreateConversation(phone);

    // Always persist sender's phone number
    if (!conversation.phone_number) {
      await updateConversation(phone, { phone_number: phone });
      conversation.phone_number = phone;
    }

    // ── Duplicate message guard ────────────────────────────────────────────────
    if (conversation.last_msg_id && conversation.last_msg_id === message.id) {
      return NextResponse.json({ status: "duplicate" }, { status: 200 });
    }

    // ── Insult detection ───────────────────────────────────────────────────────
    if (INSULT_PATTERN.test(messageText)) {
      const insultCount = ((conversation as any).insult_count ?? 0) + 1;
      await updateConversation(phone, { insult_count: insultCount } as any);
      if (insultCount >= 2) {
        await sendWhatsAppMessage(phone, "I'm going to pass you on to one of our team members who can assist you better. Take care.");
        try { await createBiginContact({ ...conversation, phone_number: phone } as any); } catch (_) {}
        return NextResponse.json({ status: "closed_insult" }, { status: 200 });
      } else {
        await sendWhatsAppMessage(phone, "I understand, we all have frustrating moments sometimes. I'm here to help whenever you're ready.");
        return NextResponse.json({ status: "insult_warned" }, { status: 200 });
      }
    }

    const currentStep = conversation.step ?? 0;
    const history: ConversationMessage[] = (conversation.messages ?? []) as ConversationMessage[];

    const coreUpdates: Partial<Conversation> = {
      last_msg_id: message.id,
      last_message_at: new Date().toISOString(),
    };

    // ── Passive: extract name at step 1 (if not already known) ────────────────
    if (currentStep === 1 && !conversation.name && messageText) {
      const extractedName = extractNameFromMessage(messageText);
      if (extractedName) (coreUpdates as any).name = extractedName;
    }

    // ── Passive: vehicle info extraction (every message, every step) ──────────
    const alreadyKnown: VehicleFields = {
      make:    (conversation.make    && conversation.make    !== "Unknown") ? conversation.make    : undefined,
      model:   (conversation.model   && conversation.model   !== "Unknown") ? conversation.model   : undefined,
      year:    conversation.year    ?? undefined,
      mileage: conversation.mileage ?? undefined,
      specs:   conversation.specs   ?? undefined,
    };
    const vehicleUpdates = await extractVehicleInfo(messageText, alreadyKnown);

    // Quick regex model match as fallback
    if (!vehicleUpdates.model || vehicleUpdates.model === "Unknown") {
      const effectiveMake = vehicleUpdates.make ?? conversation.make;
      if (effectiveMake && effectiveMake !== "Unknown") {
        const found = quickModelMatch(messageText, effectiveMake);
        if (found) {
          vehicleUpdates.model = found;
          if (vehicleUpdates.typo_check) {
            vehicleUpdates.typo_check = vehicleUpdates.typo_check.filter(t => t.field !== "model");
            if (vehicleUpdates.typo_check.length === 0) delete vehicleUpdates.typo_check;
          }
        }
      }
    }

    // Don't overwrite already-confirmed fields
    if (alreadyKnown.mileage && vehicleUpdates.mileage) delete vehicleUpdates.mileage;
    if (alreadyKnown.specs   && vehicleUpdates.specs)   delete vehicleUpdates.specs;

    // Typo auto-correct
    if (Array.isArray(vehicleUpdates.typo_check) && vehicleUpdates.typo_check.length > 0) {
      for (const tc of vehicleUpdates.typo_check) {
        if (tc.field === "model" && (!vehicleUpdates.model || vehicleUpdates.model === "Unknown")) {
          vehicleUpdates.model = tc.suggestion;
        }
        if (tc.field === "make" && (!vehicleUpdates.make || vehicleUpdates.make === "Unknown")) {
          vehicleUpdates.make = tc.suggestion;
        }
      }
      vehicleUpdates.typo_check = [];
    }

    // ── Passive: ownership ─────────────────────────────────────────────────────
    if (!(conversation as any).owner_status) {
      if (POA_PATTERN.test(messageText))        await updateConversation(phone, { owner_status: "POA" } as any).catch(() => {});
      else if (OWNER_PATTERN.test(messageText)) await updateConversation(phone, { owner_status: "Owner" } as any).catch(() => {});
    }

    // ── Passive: car condition signals ─────────────────────────────────────────
    if (CONDITION_PATTERN.test(messageText)) {
      const existing = (conversation as any).car_conditions ?? "";
      const updated  = existing ? `${existing} | ${messageText.trim()}` : messageText.trim();
      await updateConversation(phone, { car_conditions: updated } as any).catch(() => {});
    }

    // ── Passive: sell method ───────────────────────────────────────────────────
    if (!conversation.sell_timeline) {
      if (SELL_METHOD_CASH.test(messageText))
        await updateConversation(phone, { sell_timeline: "sell_method:cash" } as any).catch(() => {});
      else if (SELL_METHOD_CONSIGNMENT.test(messageText))
        await updateConversation(phone, { sell_timeline: "sell_method:consignment" } as any).catch(() => {});
    }

    // ── Resolve resolved vehicle fields ───────────────────────────────────────
    const resolvedMake    = vehicleUpdates.make    ?? conversation.make;
    const resolvedModel   = vehicleUpdates.model   ?? conversation.model;
    const resolvedYear    = vehicleUpdates.year    ?? conversation.year;
    const resolvedMileage = vehicleUpdates.mileage ?? conversation.mileage;
    const resolvedSpecs   = (vehicleUpdates.specs && vehicleUpdates.specs !== "Unknown")
                              ? vehicleUpdates.specs
                              : (conversation.specs && conversation.specs !== "Unknown" ? conversation.specs : null);

    const hasFullCar = !!(resolvedMake && resolvedMake !== "Unknown")
                    && !!(resolvedModel && resolvedModel !== "Unknown")
                    && !!resolvedYear;

    // ── Non-GCC detection (intercept before normal flow) ──────────────────────
    const isNonGcc = resolvedSpecs === "Non-GCC";
    const alreadyHandedOff = (conversation as any).non_gcc_handoff === true;
    if (isNonGcc && !alreadyHandedOff) {
      await updateConversation(phone, { non_gcc_handoff: true } as any).catch(() => {});

      const missingInfo: string[] = [];
      if (!resolvedMake  || resolvedMake  === "Unknown") missingInfo.push("make");
      if (!resolvedModel || resolvedModel === "Unknown") missingInfo.push("model");
      if (!resolvedYear)  missingInfo.push("year");
      if (!resolvedMileage) missingInfo.push("mileage");

      const nextQ = missingInfo.length > 0
        ? `Could you also share the ${missingInfo[0]} of the car?`
        : !conversation.name
          ? "And may I know your name?"
          : null;

      const handoffMsg = nextQ
        ? `Thanks for letting me know. Whether we can buy non-GCC cars depends on the specific car and its condition — it's not a standard process for us. I'll have someone from our purchasing team reach out to you directly. ${nextQ}`
        : `Thanks for letting me know. Whether we can buy non-GCC cars depends on the specific car and its condition. I'll have someone from our purchasing team reach out to you directly. Thanks — our team will be in touch shortly.`;

      await sendWhatsAppMessage(phone, handoffMsg);
      // No immediate Bigin push — if customer replies with remaining details, the
      // goodbye detection below will push. If they go silent, cron pushes after 12 min.
      return NextResponse.json({ status: "non_gcc_handoff" }, { status: 200 });
    }

    // ── Special inquiry detection (home visit / trade-in) — any step ──────────
    const isHomeVisit = HOME_VISIT_PATTERN.test(messageText);
    const isTradeIn   = TRADE_IN_PATTERN.test(messageText);
    if ((isHomeVisit || isTradeIn) && currentStep > 0) {
      const inquiryType = isHomeVisit ? "Home Visit Inquiry" : "Trade-in Inquiry";
      const inquiryTag  = isHomeVisit ? "home_visit" : "trade_in";
      await updateConversation(phone, { sell_timeline: `sell_method:${inquiryTag}` } as any);
      const replyMsg = isHomeVisit
        ? "Of course, we can look into that for you. Let me pass your details to our team and they'll be in touch with you shortly to arrange."
        : "Happy to discuss that. Let me pass your details to our team and they'll reach out to you shortly to go over the options.";
      await sendWhatsAppMessage(phone, replyMsg);
      // No immediate Bigin push — cron picks up after 12 min if customer goes silent,
      // or goodbye detection pushes if they respond and confirm.
      return NextResponse.json({ status: "special_inquiry" }, { status: 200 });
    }

    // ── Human handoff request ─────────────────────────────────────────────────
    if (HUMAN_REQUEST.test(messageText) && currentStep > 0) {
      await sendWhatsAppMessage(phone, "Of course — let me get someone from our team to reach out to you directly.");
      if (LOCATION_IMAGE_URL) await sendWhatsAppImage(phone, LOCATION_IMAGE_URL);
      await sendWhatsAppMessage(phone, LOCATION_TEXT);
      // No immediate Bigin push — cron handles it after 12 min if customer goes silent.
      return NextResponse.json({ status: "human_handoff" }, { status: 200 });
    }

    // ── Price push tracking ────────────────────────────────────────────────────
    // Track how many times they've pushed on price/method. On second push → handoff.
    const isPricePush = PRICE_PUSH_PATTERN.test(messageText);
    const pricePushCount = (conversation as any).price_push_count ?? 0;

    if (isPricePush && currentStep > 0) {
      const newCount = pricePushCount + 1;
      await updateConversation(phone, { price_push_count: newCount } as any).catch(() => {});

      if (newCount >= 2 && !(conversation as any).price_handoff_done) {
        // Second push — empathetic handoff
        await updateConversation(phone, { price_handoff_done: true } as any).catch(() => {});

        const needsCar    = !hasFullCar;
        const needsName   = !conversation.name;
        const needsPhone  = !(conversation as any).alternative_phone && !(conversation.phone_number);

        // Collect whatever's still missing, then close
        // The AI will collect via normal flow — just flag handoff in context
        // We let Claude handle the collection questions naturally via the system prompt,
        // but we track when all is collected with price_handoff_collecting flag
        if (needsCar || needsName || needsPhone) {
          await updateConversation(phone, { price_handoff_collecting: true } as any).catch(() => {});
        } else {
          // Have everything — let Claude say goodbye naturally, then push to Bigin AFTER
          // (Claude's reply will be generated below and sent; Bigin push comes after goodbye)
          await updateConversation(phone, { price_handoff_collecting: true, price_handoff_ready: true } as any).catch(() => {});
        }
      }
    }

    // ── Appointment extraction (step 2) ────────────────────────────────────────
    let apptDate = conversation.appointment_date ?? "";
    let apptTime = conversation.appointment_time ?? "";
    let altPhone: string | undefined;

    if (currentStep === 2 && messageText) {
      try {
        const ea = await extractAppointment(messageText);
        if (ea.appointment_date) apptDate = ea.appointment_date;
        if (ea.appointment_time) apptTime  = ea.appointment_time;
        const apptSave: Partial<Conversation> = {};
        if (ea.appointment_date) apptSave.appointment_date = ea.appointment_date;
        if (ea.appointment_time) apptSave.appointment_time  = ea.appointment_time;
        if (Object.keys(apptSave).length > 0) await updateConversation(phone, apptSave);
      } catch (e) {
        console.error("appointment extraction error:", e);
      }
    }

    // ── Phone capture (step 3) ─────────────────────────────────────────────────
    if (currentStep === FINAL_STEP && messageText) {
      const phoneMatch = messageText.match(/(?:\+?971|0)?[5][0-9]\d{7}/);
      if (phoneMatch) {
        const rawPhone    = phoneMatch[0].replace(/\D/g, "");
        const normalised  = rawPhone.startsWith("971") ? rawPhone : `971${rawPhone.replace(/^0/, "")}`;
        if (normalised !== phone) {
          altPhone = normalised;
          try { await updateConversation(phone, { alternative_phone: altPhone } as any); } catch (_) {}
        }
      }
    }

    // ── Valuation (informational only, never shown to customer) ───────────────
    const estMake    = resolvedMake    ?? "";
    const estModel   = resolvedModel   ?? "";
    const estYear    = resolvedYear    ?? "";
    const valuation  = (estMake && estModel && estModel !== "Unknown" && estYear)
      ? estimateCarValue(estMake, estModel, estYear, resolvedMileage, resolvedSpecs ?? undefined)
      : null;

    // ── Build context passed to Claude ────────────────────────────────────────
    const knownFields = {
      ...conversation,
      ...coreUpdates,
      ...vehicleUpdates,
      image_shared:        isImageMessage || undefined,
      dubai_hour:          getDubaiHour(),
      dubai_datetime:      getDubaiDateTime(),
      dubai_tomorrow:      getDubaiTomorrow(),
      estimated_value:     valuation?.formatted ?? null,
      appointment_date:    apptDate || conversation.appointment_date || undefined,
      appointment_time:    apptTime || conversation.appointment_time || undefined,
      // Expose price push context to Claude so it can handle naturally
      price_push_count:    isPricePush ? (pricePushCount + 1) : pricePushCount,
      price_handoff_collecting: (conversation as any).price_handoff_collecting ?? false,
    };

    console.log(`[kaya] step=${currentStep} hasCar=${hasFullCar} pricePush=${isPricePush} pricePushCount=${pricePushCount}`);

    // ── Get Claude reply ───────────────────────────────────────────────────────
    const reply = await getKayaReply(currentStep, history, messageText, knownFields);

    // Detect booking confirmation in Claude's reply
    const appointmentConfirmed = currentStep === FINAL_STEP
      && /team will be in touch on whatsapp/i.test(reply);

    // ── Send reply ─────────────────────────────────────────────────────────────
    const replyParts = reply.split(/\[SPLIT\]/i).map(s => s.trim()).filter(Boolean);
    if (appointmentConfirmed && replyParts.length > 0) {
      replyParts[replyParts.length - 1] += "\n\nHere below is our location.";
    }
    for (const part of replyParts) {
      await sendWhatsAppMessage(phone, part);
    }
    if (appointmentConfirmed) {
      if (LOCATION_IMAGE_URL) await sendWhatsAppImage(phone, LOCATION_IMAGE_URL);
      await sendWhatsAppMessage(phone, LOCATION_TEXT);
    }

    // ── Save message history ───────────────────────────────────────────────────
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

    // ── Step advancement ───────────────────────────────────────────────────────
    // Step 0 → 1: always on first reply
    // Step 1 → 2: as soon as make+model+year are all known
    // Step 2 → 3: when appointment date + time are both captured
    // Step 3 → 4 (closing): when booking is confirmed

    const hasAppt = !!(apptDate || conversation.appointment_date)
                 && !!(apptTime || conversation.appointment_time);

    // Step advancement rules (explicit per-step):
    // 0 → 1 always (greeting complete)
    // 1 → 2 when make + model + year are all resolved
    // 1 stays at 1 if car still incomplete
    // 2 → 3 when both appointment date and time are captured
    // 2 stays at 2 while appointment is still incomplete
    // 3 → 4 (closing) when booking confirmed by Claude's reply
    // 3 stays at 3 while waiting for phone confirmation
    if (currentStep === 0) coreUpdates.step = 1;
    else if (currentStep === 1) coreUpdates.step = hasFullCar ? 2 : 1;
    else if (currentStep === 2) coreUpdates.step = hasAppt ? 3 : 2;
    else if (currentStep === FINAL_STEP) coreUpdates.step = appointmentConfirmed ? CLOSING_STEP : FINAL_STEP;
    else coreUpdates.step = currentStep;

    await updateConversation(phone, coreUpdates);

    // Save vehicle updates
    if (Object.keys(vehicleUpdates).length > 0) {
      try { await updateConversation(phone, vehicleUpdates as Partial<Conversation>); }
      catch (e) { console.error("vehicleUpdates save error (non-fatal):", e); }
    }

    // Save valuation
    if (valuation?.formatted) {
      try { await updateConversation(phone, { estimated_price: valuation.formatted } as any); }
      catch (e) { console.error("estimated_price save error (non-fatal):", e); }
    }

    // ── Bigin push on booking confirmation ────────────────────────────────────
    if (appointmentConfirmed) {
      const freshConv = await getConversation(phone);
      const sellTl = (freshConv as any)?.sell_timeline ?? "";
      let salesInquiry = "Cash Deal";
      if (sellTl.includes("consignment")) salesInquiry = "Consignment";
      else if (sellTl.includes("not_sure")) salesInquiry = "Not Sure - Need Advise";

      await pushToBigin(freshConv ?? conversation, phone, history, {
        ...knownFields,
        ...(freshConv ?? {}),
        alternative_phone: altPhone ?? (freshConv as any)?.alternative_phone,
      }, salesInquiry, true);
    }

    // ── Bigin push on price handoff goodbye ───────────────────────────────────
    // Push AFTER Claude sends the goodbye — detect "have a nice day" or "team will be in touch" in price handoff context
    const isPriceHandoffReady = (conversation as any).price_handoff_ready === true;
    const isPriceHandoffCollecting = (conversation as any).price_handoff_collecting === true;
    const priceHandoffGoodbye = /have a nice day|team will be in touch|our team will be in touch/i.test(reply);
    if ((isPriceHandoffReady || isPriceHandoffCollecting) && priceHandoffGoodbye && !conversation.bigin_pushed_at) {
      const freshConv = await getConversation(phone);
      // Analyse inquiry reason from conversation context
      const convText = history.map(m => m.content).join(" ").toLowerCase();
      let salesInquiry = "Price Offer Inquiry";
      if (/urgent|asap|quick|fast|hurry|immediately/i.test(convText)) salesInquiry = "Urgent Sale Inquiry";
      else if (/mortgage|loan|finance|bank/i.test(convText)) salesInquiry = "Mortgage / Finance Inquiry";
      else if (/how much|what.*worth|value|price.*offer|offer.*price/i.test(convText)) salesInquiry = "Price Offer Inquiry";
      else if (/consign/i.test(convText)) salesInquiry = "Consignment Inquiry";
      await pushToBigin(freshConv ?? conversation, phone, history, {
        ...knownFields,
        ...(freshConv ?? {}),
      }, salesInquiry, false);
    }

    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch (error) {
    console.error("Webhook POST error:", error);
    return NextResponse.json({ status: "error" }, { status: 200 });
  }
}
