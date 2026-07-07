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
  0: undefined,       // first contact — nothing to save
  1: "name",          // customer gives name
  2: "car",           // customer states intent / car info
  3: "mileage",       // customer gives mileage + specs (raw)
  4: "loan",          // loan status
  5: "appointment",   // appointment day/time — Bigin fires after this
};

const FINAL_STEP = 5;   // appointment collected — booking complete, push to Bigin
const CLOSING_STEP = 6;

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
      await updateConversation(phone, { step: 1 }); // next message = name
      const resetReply = await getKayaReply(0, [], "hi", {});
      await sendWhatsAppMessage(phone, resetReply);
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
      (coreUpdates as any)[fieldToSave] = messageText;
    }

    // ── Vehicle extraction — runs on EVERY message ─────────────────
    // Scans for make/model/year/mileage/specs regardless of step,
    // so it doesn't matter how the customer spreads the info.
    const alreadyKnown: VehicleFields = {
      make:    conversation.make    ?? undefined,
      model:   conversation.model   ?? undefined,
      year:    conversation.year    ?? undefined,
      mileage: conversation.mileage ?? undefined,
      specs:   conversation.specs   ?? undefined,
    };
    const vehicleUpdates = await extractVehicleInfo(messageText, alreadyKnown);

    // ── Build knownFields for Kaya's system prompt ─────────────────
    const knownFields = { ...conversation, ...coreUpdates, ...vehicleUpdates };
    const reply = await getKayaReply(currentStep, [], messageText, knownFields);

    await sendWhatsAppMessage(phone, reply);

    // ── Persist core update + advance step ─────────────────────────
    const nextStep = currentStep >= CLOSING_STEP ? CLOSING_STEP : currentStep + 1;
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

    // ── Appointment date/time extraction (step 5 = appointment answer) ──
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
