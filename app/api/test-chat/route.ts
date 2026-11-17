import { NextRequest, NextResponse } from "next/server";
import { sessionUser } from "@/lib/monitorRole";
import { planEmergencyTurn, emergencyInput } from "@/lib/emergency-basic-bot";
import { type Chat, type Vehicle } from "@/lib/conversation-state";
import { extractVehicleInfo } from "@/lib/claude";
import { detect, regression } from "@/lib/kaya-improve/detect";
import { futureSellerRegression } from "@/lib/kaya-improve/future-seller-regression";
import { planV2 } from "@/lib/kaya-v2/turn";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function POST(req: NextRequest) {
  const user = await sessionUser(req);
  if (!user || user.role !== "super_admin") return NextResponse.json({ error: "Admin login required" }, { status: 401 });
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return NextResponse.json({ error: "Cross-origin requests disabled" }, { status: 403 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 2000) return NextResponse.json({ error: "Message must be 1–2000 characters" }, { status: 400 });
  const previous: Chat = body.chat && typeof body.chat === "object" && !Array.isArray(body.chat) ? body.chat : {};
  const messages = Array.isArray(previous.messages) ? previous.messages.filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-30) : [];
  const chat: Chat = { messages, flow_state: previous.flow_state && typeof previous.flow_state === "object" ? previous.flow_state : undefined };
  for (const key of ["name", "make", "model", "year", "mileage", "specs", "loan", "appointment_date", "appointment_time", "car_conditions", "phone_number", "sell_timeline"]) {
    if (typeof previous[key] === "string" && previous[key].length < 300) chat[key] = previous[key];
  }
  if (body.engine === "v2") {
    // Kaya v2 simulation: same reading + flow as live, nothing saved, sent or pushed to Bigin.
    try {
      const sim: any = { ...chat, phone: typeof body.phone === "string" && /^\d{8,15}$/.test(body.phone) ? body.phone : "971500000000" };
      if (previous.flow_state && (previous.flow_state as any).engine === "v2") sim.flow_state = previous.flow_state;
      for (const key of ["car_conditions"]) if (typeof previous[key] === "string") sim[key] = previous[key];
      const { plan, understanding, aiOk } = await planV2(sim, message, new Date(), undefined, async () => null);
      const next: Chat = { ...sim, ...plan.updates, messages: [...messages, { role: "user", content: message }, ...(plan.reply ? [{ role: "assistant", content: plan.reply }] : [])].slice(-30) };
      return NextResponse.json({ reply: plan.reply, chat: next, state: { ...plan.state, outcome: plan.outcome, reason: plan.reason, read: understanding, aiOk }, source: "kaya-v2", isolated: true, note: "Kaya v2 simulation; no booking, callback or WhatsApp message is sent." }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      console.error("[test-chat v2]", e);
      return NextResponse.json({ error: "Test engine failed" }, { status: 500 });
    }
  }
  try {
    const interpreted = message;
    const fields: Vehicle = /\d|\b(car|model|gcc|spec|sell|selling)\b/i.test(message)
      ? await extractVehicleInfo(emergencyInput(message).text, { make: chat.make || undefined, model: chat.model || undefined, year: chat.year || undefined }).catch(() => ({})) : {};
    const turn = planEmergencyTurn(chat, interpreted, fields);
    const next: Chat = { ...chat, ...turn.updates, messages: [...messages, { role: "user", content: message }, { role: "assistant", content: turn.reply }].slice(-30) };
    const analysis = detect({phone:"00000000",name:next.name,appointment_date:next.appointment_date,appointment_time:next.appointment_time,messages:next.messages});
    const tests = [...regression(), ...futureSellerRegression()];
    return NextResponse.json({ reply: turn.reply, chat: next, state: turn.state, intelligence:{findings:analysis.findings.map((f,i)=>({...f,id:`test-${i+1}`,status:"flagged",verification:"Rule-based detection; requires independent confirmation"})),regression:{passed:tests.filter(t=>t.passed).length,total:tests.length,results:tests},stages:[{name:"Detect",status:"complete"},{name:"Flag",status:analysis.findings.length?"flagged":"clear"},{name:"Analyze",status:analysis.findings.length?"awaiting independent verification":"not required"},{name:"Solution",status:analysis.findings.length?"suggestions available":"not required"},{name:"Test",status:"baseline regression executed"},{name:"Deploy",status:"sandbox blocked"}]}, source: "emergency-chat-bot-v1", isolated: true, note: "Emergency Chat Bot V1 simulation; no booking, callback or WhatsApp message is sent." }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[test-chat]", e);
    return NextResponse.json({ error: "Test engine failed" }, { status: 500 });
  }
}
