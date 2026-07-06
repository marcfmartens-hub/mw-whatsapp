import { NextRequest, NextResponse } from "next/server";
import { getOrCreateConversation, updateConversation, resetConversation, Conversation } from "@/lib/supabase";
import { getKayaReply, extractCarFields, extractMileageSpec } from "@/lib/claude";
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

// Maps the conversation's CURRENT step to which field the incoming
// message should be saved into. Step 0 has no field to save — the
// first inbound message is just the customer initiating contact.
const FIELD_BY_STEP: Record<number, keyof Conversation | undefined> = {
  0: undefined,
  1: "name",
  2: "phone_number",
  3: "car",
  4: "mileage",
  5: "loan",
  6: "appointment",
};

const FINAL_STEP = 6;
const CLOSING_STEP = 7;

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

    // Status updates (delivered/read/sent) carry `statuses`, not `messages`.
    if (!value?.messages || value.messages.length === 0) {
      return null;
    }

    const message = value.messages[0];
    return {
      from: message.from,
      id: message.id,
      text: message.text,
      type: message.type,
    };
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

    if (!message) {
      // Status update or unrecognized payload — acknowledge and skip.
      return NextResponse.json({ status: "ignored" }, { status: 200 });
    }

    const ownPhoneNumberId = process.env.META_PHONE_NUMBER_ID;
    if (ownPhoneNumberId && message.from === ownPhoneNumberId) {
      // Echo of our own outbound message — skip.
      return NextResponse.json({ status: "ignored" }, { status: 200 });
    }

    const phone = message.from;
    const messageText = message.text?.body?.trim() ?? "";

    // ── Reset trigger ──────────────────────────────────────────────
    if (messageText.toLowerCase() === RESET_KEYWORD) {
      await resetConversation(phone);
      const freshConversation = await getOrCreateConversation(phone);
      const resetReply = await getKayaReply(0, [], "");
      await sendWhatsAppMessage(phone, resetReply);
      return NextResponse.json({ status: "reset" }, { status: 200 });
    }
    // ──────────────────────────────────────────────────────────────

    const conversation = await getOrCreateConversation(phone);

    // Deduplicate retried/duplicate webhook deliveries.
    if (conversation.last_msg_id && conversation.last_msg_id === message.id) {
      return NextResponse.json({ status: "duplicate" }, { status: 200 });
    }

    const currentStep = conversation.step ?? 0;

    // Persist the field collected at this step (if any) before replying.
    const fieldToSave = FIELD_BY_STEP[currentStep];
    const updates: Partial<Conversation> = { last_msg_id: message.id };
    if (fieldToSave && messageText) {
      (updates as any)[fieldToSave] = messageText;
    }

    // Extract structured fields from free-text answers
    if (fieldToSave === "car" && messageText) {
      const { make, model, year } = await extractCarFields(messageText);
      updates.make = make || null;
      updates.model = model || null;
      updates.year = year || null;
    }
    if (fieldToSave === "mileage" && messageText) {
      const { mileage, specs } = await extractMileageSpec(messageText);
      updates.mileage = mileage || null;
      updates.specs = specs || null;
    }

    // Merge pending updates into conversation so Kaya sees the latest data
    const knownFields = { ...conversation, ...updates };
    const reply = await getKayaReply(currentStep, [], messageText, knownFields);

    await sendWhatsAppMessage(phone, reply);

    const nextStep = currentStep >= CLOSING_STEP ? CLOSING_STEP : currentStep + 1;
    updates.step = nextStep;

    const updatedConversation = await updateConversation(phone, updates);

    if (currentStep === FINAL_STEP) {
      await createBiginContact(updatedConversation);
    }

    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch (error) {
    console.error("Webhook POST error:", error);
    return NextResponse.json({ status: "error" }, { status: 200 });
  }
}
