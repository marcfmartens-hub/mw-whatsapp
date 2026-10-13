const GRAPH_API_VERSION = "v21.0";

// Stress-test simulation: messages to registered test phones are captured, never sent.
export function simLog(to: string): string[] | null {
  const sim = (globalThis as any).__kayaSim as Map<string, string[]> | undefined;
  return sim?.get(to) ?? null;
}

export async function sendWhatsAppImage(to: string, imageUrl: string, caption?: string): Promise<void> {
  const log = simLog(to); if (log) { log.push(`[image] ${caption ?? ""}`); return; }
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    throw new Error("Missing META_PHONE_NUMBER_ID or META_ACCESS_TOKEN env vars");
  }

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "image",
      image: { link: imageUrl, ...(caption ? { caption } : {}) },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("Meta send image error:", res.status, errText);
    throw new Error(`Failed to send WhatsApp image: ${res.status} ${errText}`);
  }
}

// Same wording fixes for what is sent and what is saved in the chat history (monitor shows what the customer got)
export function polishOutgoing(body: string, forHistory = false): string {
  {
    const h = new Date(Date.now() + 4 * 3600e3).getUTCHours();
    const g = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
    // Marc: never "Hi" or "Hello" — "Good evening! I'm Kaya…" (history: only replace Hi/Hello so old greetings keep their time of day)
    body = forHistory
      ? body.replace(/^(?:Hi|Hello|Hey)(?:,?\s+(?:good (?:morning|afternoon|evening)))?!(\s+I'm Kaya)/i, `${g}!$1`)
      : body.replace(/^(?:Hi|Hello|Hey|Good (?:morning|afternoon|evening))(?:,?\s+(?:good (?:morning|afternoon|evening)))?!(\s+I'm Kaya)/i, `${g}!$1`);
  }
  // After 5 PM Dubai time: "Have a nice evening" instead of "Have a nice day"
  if (!forHistory && new Date(Date.now() + 4 * 3600e3).getUTCHours() >= 17) body = body.replace(/Have a nice day/g, "Have a nice evening");
  // The name is used once only (Marc) — never in thanks / goodbyes ("You're welcome, Marcio!")
  body = body.replace(/\b(You'?re welcome|Thanks|Thank you|See you (?:later|soon|tomorrow)|Have a nice (?:day|evening))(?:,?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?=\s*[!.,])/g, "$1");
  // "See you later/soon/tomorrow" already says goodbye — no "have a nice day/evening" on top (Marc)
  if (/\bSee you (later|soon|tomorrow)\b/i.test(body)) {
    body = body
      .replace(/,?\s*and\s+have a nice (day|evening)/gi, "")
      .replace(/\s*Have a nice (day|evening)[^!.]*[!.]/gi, "")
      .trim();
  }
  return body;
}

export async function sendWhatsAppMessage(to: string, body: string): Promise<void> {
  body = polishOutgoing(body);
  const log = simLog(to); if (log) { log.push(body); return; }
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    throw new Error("Missing META_PHONE_NUMBER_ID or META_ACCESS_TOKEN env vars");
  }

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("Meta send message error:", res.status, errText);
    throw new Error(`Failed to send WhatsApp message: ${res.status} ${errText}`);
  }
}

// Blue ticks + "typing…" in the customer's chat while Kaya prepares the reply.
// WhatsApp shows the indicator until the reply arrives (max ~25 s). Never throws.
export async function sendTypingIndicator(messageId: string): Promise<void> {
  try {
    if (messageId.startsWith("sim_")) return;
    const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
    const accessToken = process.env.META_ACCESS_TOKEN;
    if (!phoneNumberId || !accessToken || !messageId) return;
    const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId, typing_indicator: { type: "text" } }),
    });
    if (!res.ok) console.warn("[meta] typing indicator failed:", res.status, await res.text().catch(() => ""));
  } catch (e) { console.warn("[meta] typing indicator error:", e); }
}
