import { getConversation, updateConversation, type Conversation } from "@/lib/supabase";
import { extractVehicleInfo, generateInquirySummary } from "@/lib/claude";
import { sendWhatsAppMessage } from "@/lib/meta";
import { createBiginContact, createChangeTask, moveLeadToCallBack } from "@/lib/bigin";
import { pickDefaultTime } from "@/lib/slots";
import { planTurn, flowState, slotValid, STATUS_LABELS, LOCATION, type Turn } from "./conversation-state";
import { learnedMessage } from "./kaya-improve/learning";

export async function handleConversationTurn(c: Conversation, text: string) {
  const original = { ...c };
  // Preserve raw history; learned aliases inform interpretation only.
  const interpreted = learnedMessage(text);
  const fields = /\d|\b(car|model|gcc|spec|sell|selling)\b/i.test(text)
    ? await extractVehicleInfo(text, { make: c.make || undefined, model: c.model || undefined, year: c.year || undefined }).catch(() => ({})) : {};
  const turn = planTurn(c, interpreted, fields);
  if (turn.defaultDate) {
    try { await chooseDefault(turn, c.phone); }
    catch { turn.reply = "I couldn't find an available slot within that period. Which other day or exact time would suit you?"; turn.state.question = "time"; }
  }
  if (turn.crm === "change" && original.appointment_date && original.appointment_time)
    turn.state.pendingTask = { date: original.appointment_date, time: original.appointment_time, request: text };
  // Facts and pending intent survive a delivery failure. A confirmed booking or
  // consent acknowledgement is committed only after the actual reply succeeds.
  const staged = structuredClone(turn.updates);
  if (turn.confirm || turn.state.status === "default_pending") {
    staged.flow_state.status = "awaiting_confirmation";
    staged.appointment_date = null; staged.appointment_time = null;
  }
  const stored = await updateConversation(c.phone, staged);
  if (!stored.flow_state) throw new Error("Conversation state schema is not installed; no reply sent");
  await sendWhatsAppMessage(c.phone, turn.reply);
  const fresh = await getConversation(c.phone);
  const saved = await updateConversation(c.phone, {
    ...turn.updates,
    // The inbound was already saved. Append the sent reply to the latest copy,
    // including any newer inbound messages rather than overwriting them.
    messages: [...(fresh?.messages ?? c.messages ?? []), { role: "assistant" as const, content: turn.reply }].slice(-40),
  });
  if (turn.crm) {
    try {
      const summary = await generateInquirySummary(saved.messages ?? [], { ...saved }).catch(() => "");
      const state = flowState(saved);
      const note = [STATUS_LABELS[state.status], state.proposedDate ? `Proposed visit: ${state.proposedDate} ${state.proposedTime || "time not chosen"}` : "",
        state.consent === "declined" ? "Customer will contact us / no personal callback consent." : "",
        state.vehicles?.length ? `Vehicles (separate): ${JSON.stringify(state.vehicles)}` : "", summary].filter(Boolean).join("\n\n");
      const ok = await createBiginContact({ ...saved, phone_number: saved.phone_number || saved.phone,
        inspection_booked: state.status === "booked", inquiry_summary: note,
        clear_appointment: state.status !== "booked", sales_inquiry: state.status === "booked" ? "Not Sure - Need Advise" : state.status === "team_accepted" ? "Other" : "No Communication yet",
      } as any);
      if (!ok) throw new Error("Bigin did not confirm the write");
      if (turn.crm === "change" && original.appointment_date && original.appointment_time) {
        const task = await createChangeTask(original, "OTHER", `${STATUS_LABELS[state.status]} — ${text}`);
        if (!task.ok) throw new Error("Appointment change needs a linked task retry");
        delete state.pendingTask;
        await updateConversation(c.phone, { flow_state: state });
      }
      if (state.status === "team_accepted") await moveLeadToCallBack(c.phone);
      await updateConversation(c.phone, { bigin_pushed_at: new Date().toISOString(), inquiry_summary: note });
    } catch (error) { console.error("[conversation] CRM forwarding pending retry", error); }
  }
  return turn.state.status;
}

export async function chooseDefault(turn: Turn, phone: string, now = new Date()) {
  const state = turn.state;
  const date = turn.defaultDate;
  if (!date) return;
  const time = await pickDefaultTime(date, phone, state.part);
  const minute = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  if (!slotValid(date, time, now) || !/:15$/.test(time) || state.timeMin != null && minute < state.timeMin || state.timeMax != null && minute > state.timeMax) {
    turn.reply = "I couldn't find an available default slot within your availability. Which other day or exact time would suit you?";
    state.question = "time"; return;
  }
  state.proposedDate = date; state.proposedTime = time; state.status = "default_pending"; state.question = "";
  turn.updates.flow_state = state; turn.updates.step = 8;
  turn.updates.appointment_date = null; turn.updates.appointment_time = null;
  turn.reply = `I've selected ${date} at ${time} for your inspection. Our call centre will confirm the exact timing with you in the morning.\n\n${LOCATION}`;
  turn.crm = "lead";
}
