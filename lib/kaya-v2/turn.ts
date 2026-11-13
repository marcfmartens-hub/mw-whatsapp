// Kaya v2 — one customer turn: read the message, run the flow, save, send, push to Bigin.
import { type Conversation, updateConversation, getConversation } from "../supabase";
import { sendWhatsAppMessage } from "../meta";
import { syncBiginOutcome } from "../bigin-outcome";
import { pickDefaultTime } from "../slots";
import { understand, haikuCall, type Understanding } from "./understand";
import { plan, nextBookableDay, type Plan } from "./flow";

export const V2_MODE = "Kaya v2";

/** Who gets v2: KAYA_V2=all, or a comma list of WhatsApp numbers (digits). Anything else → emergency bot. */
export function v2Enabled(phone: string): boolean {
  const flag = (process.env.KAYA_V2 || "").trim();
  if (flag.toLowerCase() === "all") return true;
  if (!flag) return false;
  return flag.split(",").map((p) => p.replace(/\D/g, "")).filter(Boolean).includes(phone.replace(/\D/g, ""));
}

export function splitMedia(text: string): { media: string[]; text: string } {
  const media: string[] = [];
  if (/\[(?:photo|image)\]/i.test(text)) media.push("photos");
  if (/\[(?:file|document|video)\]/i.test(text)) media.push("files");
  if (/\[(?:audio|voice)\]/i.test(text)) media.push("voice notes");
  if (/https?:\/\/|www\./i.test(text)) media.push("links");
  const clean = text
    .replace(/\[(?:photo|image|file|document|video|audio|voice|unsupported|location)\]/gi, " ")
    .replace(/(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(/[ \t]+/g, " ").trim();
  return { media, text: clean };
}

const knownOf = (c: any) => ({
  name: c.name, make: c.make, model: c.model, year: c.year, mileage: c.mileage, specs: c.specs, loan: c.loan,
  appointment: c.appointment_date ? `${c.appointment_date} ${c.appointment_time ?? ""}` : null,
});
const lastKaya = (c: any) => [...(c.messages || [])].reverse().find((m: any) => m.role === "assistant")?.content ?? "";

/** Runs the read + flow without any side effects. Used live, in the test chat and in the replay. */
export async function planV2(
  c: any, raw: string, now = new Date(),
  call: (system: string, user: string) => Promise<string> = haikuCall,
  slotLookup: (date: string, part?: string | null) => Promise<string | null> = liveDefaultTime(c.phone),
): Promise<{ plan: Plan; understanding: Understanding; aiOk: boolean }> {
  const { media, text } = splitMedia(raw);
  const { u, ok } = await understand(text, { now, lastKaya: lastKaya(c), known: knownOf(c) }, call);
  // Default times for the days this turn may book (12:15, or the next free :15)
  const days = [...new Set([u.visit.date, nextBookableDay(now)].filter(Boolean))] as string[];
  const times = new Map<string, string | null>();
  await Promise.all(days.map(async (d) => times.set(d + "|" + (u.visit.part_of_day ?? ""), await slotLookup(d, u.visit.part_of_day).catch(() => null))));
  const p = plan(c, u, {
    now, phone: String(c.phone || ""), media, textEmpty: !text,
    defaultTime: (d, part) => times.get(d + "|" + (part ?? "")) ?? times.get(d + "|") ?? null,
  });
  return { plan: p, understanding: u, aiOk: ok };
}

function liveDefaultTime(phone: string) {
  return async (date: string, part?: string | null) => {
    try { return await pickDefaultTime(date, phone, (part as any) || undefined); } catch { return null; }
  };
}

export async function kayaV2Turn(c: Conversation, text: string): Promise<string> {
  const { plan: p, understanding } = await planV2(c, text);
  const fresh = await getConversation(c.phone);
  const messages = [...(fresh?.messages || c.messages || []), ...(p.reply ? [{ role: "assistant" as const, content: p.reply }] : [])].slice(-40);
  const flow_state = { ...(p.updates.flow_state || {}), lastUnderstanding: understanding };
  await updateConversation(c.phone, { ...p.updates, flow_state, messages, step: p.outcome === "booked" ? 8 : Math.max(c.step || 0, 1) } as any);
  const saved = await getConversation(c.phone);
  try { if (p.reply) await sendWhatsAppMessage(c.phone, p.reply); }
  finally { if (saved && p.outcome !== "none") await syncBiginOutcome(saved, p.outcome, p.reason); }
  return p.outcome === "none" ? "collecting" : p.outcome;
}
