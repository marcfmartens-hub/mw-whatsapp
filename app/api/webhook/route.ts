import { emergencyBasicTurn } from "@/lib/emergency-basic-bot";
import { saveInbound } from "@/lib/inbound";
import { NextRequest, NextResponse } from "next/server";
import { getOrCreateConversation, updateConversation, resetConversation, getConversation } from "@/lib/supabase";
import type { ConversationMessage } from "@/lib/claude";
import { sendWhatsAppMessage, sendTypingIndicator } from "@/lib/meta";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RESET_KEYWORD = "reset chat 007";

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

interface IncomingMessage {
  from: string;
  id: string;
  text?: { body?: string };
  image?: { caption?: string };
  document?: { caption?: string; filename?: string };
  video?: { caption?: string };
  type: string;
  referral?: { source_url?: string; source_id?: string; source_type?: string; headline?: string; body?: string; ctwa_clid?: string };
}

function extractMessage(body: any): IncomingMessage | null {
  try {
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    if (!value?.messages || value.messages.length === 0) return null;
    const message = value.messages[0];
    return { from: message.from, id: message.id, text: message.text, image: message.image, document: message.document, video: message.video, type: message.type, referral: message.referral };
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

  let inboundCommitted = false;
  let claimedPhone: string | null = null;   // set while this request is writing a reply
  try {
    const message = extractMessage(body);
    if (!message) return NextResponse.json({ status: "ignored" }, { status: 200 });

    const ownPhoneNumberId = process.env.META_PHONE_NUMBER_ID;
    if (ownPhoneNumberId && message.from === ownPhoneNumberId) {
      return NextResponse.json({ status: "ignored" }, { status: 200 });
    }

    const phone   = message.from;
    let messageText = message.text?.body?.trim() ?? message.image?.caption?.trim()
      ?? message.document?.caption?.trim() ?? message.video?.caption?.trim() ?? "";

    // ── Voice notes / media without text ────────────────────────────
    if (message.type === "reaction") return NextResponse.json({ status: "ignored" }, { status: 200 });
    if (message.type === "sticker") return NextResponse.json({ status: "ignored" }, { status: 200 });
    // Commit the customer's message before Meta, Claude, or any early-return branch.
    // Keep the pre-message snapshot for restart detection and step processing below.
    const inbound = await saveInbound(phone, message.id,
      (["image", "document", "video"].includes(message.type)
        ? `[${message.type === "image" ? "photo" : "file"}]${messageText ? " " + messageText : ""}`
        : messageText || `[${message.type}]`), getOrCreateConversation, updateConversation);
    inboundCommitted = true;
    if (inbound.duplicate) return NextResponse.json({ status: "duplicate" }, { status: 200 });
    const conversation = inbound.before;
    if (message.type === "audio") messageText="[audio]";
    // Photos / files: Kaya can't open them. Tag them so the whole batch gets ONE reply,
    // and any caption / ad text sent with them is still read.
    const isMedia = ["image", "document", "video"].includes(message.type);
    if (isMedia) messageText = `[${message.type === "image" ? "photo" : "file"}]${messageText ? " " + messageText : ""}`;
    if (!messageText && message.type !== "text" && message.type !== "location") {
      await sendWhatsAppMessage(phone, "Thanks! Could you type your message so I can help?");
      return NextResponse.json({ status: "media_no_text" }, { status: 200 });
    }

    // ── Lead source: Click-to-WhatsApp ad (Meta adds the ad details to the first message) ──
    if (message.referral && (message.referral.source_id || message.referral.headline || message.referral.source_url)) {
      try {
        const r = message.referral;
        const ref = { source_type: r.source_type, source_id: r.source_id, headline: r.headline?.slice(0, 120), body: r.body?.slice(0, 200), source_url: r.source_url, ctwa_clid: r.ctwa_clid };
        await getOrCreateConversation(phone);
        await updateConversation(phone, { source_url: JSON.stringify(ref) } as any);
        console.log(`[source] ${phone} came from ad ${r.source_id ?? "?"} "${r.headline ?? ""}"`);
      } catch (e) { console.warn("[source] could not save the ad referral:", e); }
    }

    // ── English only ───────────────────────────────────────────────
    // Arabic, Cyrillic, Indian scripts, CJK, Korean → never reply in that language, ask for English
    if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0400-\u04FF\u0900-\u0DFF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(messageText)) {
      await sendWhatsAppMessage(phone, "Sorry, I can only assist in English. Could you please continue in English?");
      return NextResponse.json({ status: "non_english" }, { status: 200 });
    }

    // ── Reset trigger ──────────────────────────────────────────────
    if (messageText.toLowerCase() === RESET_KEYWORD) {
      try {
        await resetConversation(phone);
        const reply = "Hi, I'm Kaya, Mister Wheelz's virtual assistant. What's your name?";
        await sendWhatsAppMessage(phone, reply);
        // Greeting sent → next message is the name (step 1)
        await getOrCreateConversation(phone);
        await updateConversation(phone, {
          step: 1,
          phone_number: phone,
          flow_state: { basicMode: "Emergency Chat Bot V1", basicStep: "name" },
          last_message_at: new Date().toISOString(),
          messages: [{ role: "assistant", content: reply }],
        } as any);
      } catch (e) {
        // Don't fake success — if the reset failed, say so, otherwise it looks like it worked
        console.error("reset handler error:", e);
        await sendWhatsAppMessage(phone, `⚠️ Reset failed: ${(e as any)?.message ?? e}`).catch(() => {});
      }
      return NextResponse.json({ status: "reset" }, { status: 200 });
    }
    // ──────────────────────────────────────────────────────────────

    void sendTypingIndicator(message.id); // customer sees "typing…" during the burst wait + reply
    const freshConversation = await getConversation(phone).catch(() => null);
    if (freshConversation) Object.assign(conversation, freshConversation);

    let mediaInBurst = false;
    // ── Burst handling ─────────────────────────────────────────────
    // Customers often send 2–3 quick messages ("fine monday 7pm" / "actually 6"). Record this
    // message, wait a few seconds, and only the LATEST message replies — covering the whole burst.
    {
      const prior = (conversation.messages ?? []) as ConversationMessage[];
      // Incoming history was saved before entering the burst wait.
      const bareMedia = /^\[(photo|file)\]$/.test(messageText);
      // The inbound text and timestamp were already committed before any outbound call.
      await new Promise(r => setTimeout(r, message.id.startsWith("sim_") ? 200 : isMedia ? 8000 : 4000));
      let after = await getConversation(phone).catch(() => null);
      if (after && after.last_msg_id && after.last_msg_id !== message.id) {
        return NextResponse.json({ status: "superseded" }, { status: 200 });
      }
      // Another reply still being written → wait for it, then answer only what's new
      const busyUntil = (after as any)?.processing_until ? Date.parse((after as any).processing_until) : 0;
      if (busyUntil > Date.now()) {
        const deadline = Math.min(busyUntil, Date.now() + 25000);
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 1000));
          const c2 = await getConversation(phone).catch(() => null);
          if (c2?.last_msg_id && c2.last_msg_id !== message.id) return NextResponse.json({ status: "superseded" }, { status: 200 });
          if (!(c2 as any)?.processing_until || Date.parse((c2 as any).processing_until) <= Date.now()) { after = c2; break; }
        }
        after = (await getConversation(phone).catch(() => null)) ?? after;
      }
      await updateConversation(phone, { processing_until: new Date(Date.now() + 30000).toISOString() } as any)
        .then(() => { claimedPhone = phone; }).catch(() => {});
      const ownText = messageText;
      // Combine the trailing customer messages (the burst) into one, history = everything before
      const msgs = ((after?.messages ?? [...prior, { role: "user", content: messageText }]) as ConversationMessage[]);
      let i = msgs.length;
      while (i > 0 && msgs[i - 1].role === "user") i--;
      const burst = msgs.slice(i).map(m => m.content).filter(Boolean);
      if (bareMedia && !burst.includes(messageText)) burst.push(messageText);
      else if (!burst.includes(ownText)) burst.push(ownText); // our message was overwritten by the previous reply's save
      if (after) Object.assign(conversation, after);
      conversation.messages = msgs.slice(0, i) as any;
      if (burst.length > 1) messageText = burst.join("\n");
      // Preserve attachment types through batching; the emergency engine explains
      // only the types actually received and can still collect typed captions.
      const MEDIA_TAG = /^\[(photo|file|audio)\]\s*/;
      mediaInBurst = burst.some(b => MEDIA_TAG.test(b));
      if (mediaInBurst) messageText = burst.join("\n");
    }

    const status = await emergencyBasicTurn(conversation,
      messageText || (mediaInBurst ? "[photo]" : message.type === "location" ? "Where is your location?" : "[unsupported]"));
    return NextResponse.json({ status, mode: "Emergency Basic Bot V1" }, { status: 200 });

  } catch (error) {
    console.error("Webhook POST error:", error);
    // Retry storage failures; do not replay an already committed customer message.
    return NextResponse.json({ status: "error" }, { status: inboundCommitted ? 200 : 503 });
  } finally {
    if (claimedPhone) await updateConversation(claimedPhone, { processing_until: null } as any).catch(() => {});
  }
}
