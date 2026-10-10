const GRAPH_API_VERSION = "v21.0";

export async function sendWhatsAppImage(to: string, imageUrl: string, caption?: string): Promise<void> {
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

export async function sendWhatsAppMessage(to: string, body: string): Promise<void> {
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
