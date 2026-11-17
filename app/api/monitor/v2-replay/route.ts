// Kaya v2 replay: runs the latest real conversations through the new flow and shows
// what Kaya said then next to what v2 would say. Read-only: nothing is saved, sent or pushed to Bigin.
// Super Admin only. Open /api/monitor/v2-replay?limit=60 after logging in to /monitor.
import { NextRequest, NextResponse } from "next/server";
import { sessionUser } from "@/lib/monitorRole";
import { supabase } from "@/lib/supabase";
import { planV2 } from "@/lib/kaya-v2/turn";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Msg = { role: "user" | "assistant"; content: string };
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));

function oldOutcome(c: any): string {
  const st = c.flow_state?.status;
  if (st === "booked" || c.flow_state?.basicStep === "done" && c.appointment_date) return "booked";
  if (st === "team_accepted" || c.flow_state?.basicStep === "callback") return "callback";
  if (!(c.messages || []).some((m: Msg) => m.role === "user")) return "no reply";
  return "open";
}

async function replay(c: any) {
  const original: Msg[] = (c.messages || []).filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
  // Customer messages sent back-to-back are read together, like the live webhook does.
  const bursts: string[] = [];
  let cur: string[] = [];
  for (const m of original) {
    if (m.role === "user") cur.push(m.content);
    else if (cur.length) { bursts.push(cur.join("\n")); cur = []; }
  }
  if (cur.length) bursts.push(cur.join("\n"));
  const when = new Date(c.last_message_at || Date.now());
  const sim: any = { phone: c.phone, messages: [] as Msg[] };
  const v2: { customer: string; kaya: string; outcome: string; read: any }[] = [];
  let outcome = "open";
  for (const b of bursts.slice(0, 15)) {
    const { plan, understanding } = await planV2(sim, b, when, undefined, async () => null);
    Object.assign(sim, plan.updates);
    sim.messages.push({ role: "user", content: b });
    if (plan.reply) sim.messages.push({ role: "assistant", content: plan.reply });
    if (plan.outcome === "booked") outcome = "booked";
    else if (plan.outcome === "callback" && outcome !== "booked") outcome = "callback";
    v2.push({ customer: b, kaya: plan.reply, outcome: plan.outcome, read: understanding });
  }
  if (outcome === "open" && sim.flow_state?.status === "closed") outcome = "not a lead";
  return { phone: c.phone, name: c.name, original, old: oldOutcome(c), v2, outcome, fields: { name: sim.name, car: [sim.make, sim.model, sim.year].filter(Boolean).join(" "), mileage: sim.mileage, specs: sim.specs } };
}

export async function GET(req: NextRequest) {
  const user = await sessionUser(req);
  if (!user || user.role !== "super_admin") return NextResponse.json({ error: "Admin login required" }, { status: 401 });
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit")) || 60, 1), 100);
  const { data, error } = await supabase.from("mw_whatsapp").select("*").order("last_message_at", { ascending: false }).limit(limit + 20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const chats = (data || []).filter((c: any) => !String(c.phone).startsWith("971599900") && (c.messages || []).some((m: Msg) => m.role === "user")).slice(0, limit);

  const results: any[] = new Array(chats.length);
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < chats.length) {
      const i = next++;
      try { results[i] = await replay(chats[i]); }
      catch (e) { results[i] = { phone: chats[i].phone, error: String(e), original: [], v2: [], old: oldOutcome(chats[i]), outcome: "error" }; }
    }
  }));

  if (req.nextUrl.searchParams.get("format") === "json") return NextResponse.json({ results });

  const count = (key: "old" | "outcome", v: string) => results.filter((r) => r[key] === v).length;
  const rows = ["booked", "callback", "open", "not a lead", "no reply", "error"].map((o) =>
    `<tr><td>${o}</td><td>${count("old", o)}</td><td>${count("outcome", o)}</td></tr>`).join("");
  const chatsHtml = results.map((r, i) => `
  <section><h3>Chat ${String(i + 1).padStart(2, "0")} · ${esc(r.name || "no name")} · +${esc(String(r.phone).slice(0, 5))}… — before: <b>${r.old}</b> → v2: <b class="${r.outcome}">${r.outcome}</b></h3>
  <p class="f">v2 saved: ${esc(Object.entries(r.fields || {}).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(", ") || "—")}</p>
  <div class="cols"><div><h4>Before (live)</h4>${r.original.map((m: Msg) => `<p class="${m.role}">${esc(m.content)}</p>`).join("")}</div>
  <div><h4>Kaya v2</h4>${r.v2.map((t: any) => `<p class="user">${esc(t.customer)}</p>${t.kaya ? `<p class="assistant">${esc(t.kaya)}</p>` : `<p class="silent">(no reply)</p>`}`).join("")}${r.error ? `<p class="silent">${esc(r.error)}</p>` : ""}</div></div></section>`).join("");
  const html = `<!doctype html><meta charset="utf-8"><title>Kaya v2 replay</title><style>
  body{font:14px/1.45 system-ui;margin:24px;max-width:1200px;color:#222}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 10px}
  section{border-top:1px solid #ddd;padding:12px 0}.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  p{white-space:pre-wrap;margin:4px 0;padding:6px 9px;border-radius:8px}.user{background:#f1f1f1}.assistant{background:#e3f4e6}.silent{color:#888;font-style:italic}
  .f{color:#555;font-size:12px}.booked{color:#0a7}.callback{color:#c60}</style>
  <h1>Kaya v2 replay — ${results.length} latest chats</h1>
  <p>The customer's messages are replayed in order. v2 might have changed what customers say next, so later turns are approximate. Nothing was sent or saved.</p>
  <table><tr><th>Outcome</th><th>Before</th><th>v2</th></tr>${rows}</table>${chatsHtml}`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
