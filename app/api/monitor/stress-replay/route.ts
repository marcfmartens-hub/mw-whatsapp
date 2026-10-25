import { NextRequest, NextResponse } from "next/server";
import { sessionUser } from "@/lib/monitorRole";
import { supabase } from "@/lib/supabase";
import { planTurn } from "@/lib/conversation-state";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Read-only replay: executes production conversation logic, but never calls Meta,
// Bigin, or Supabase writes. Only a signed-in monitor super admin can run it.
export async function POST(req: NextRequest) {
  const user = await sessionUser(req);
  if (!user || user.role !== "super_admin")
    return NextResponse.json({ error: "Super admin login required" }, { status: 403 });

  const { data, error } = await supabase.from("mw_whatsapp")
    .select("id,created_at,last_message_at,messages")
    .order("created_at", { ascending: false }).limit(40);
  if (error) return NextResponse.json({ error: "Conversation read failed" }, { status: 500 });

  const source = (data ?? []).filter(c => Array.isArray(c.messages) &&
    c.messages.some((m: any) => m?.role === "user") &&
    !c.messages.some((m: any) => String(m?.content ?? "").includes("Kaya Stress Test"))
  ).slice(0, 20);

  const results = source.map((c, index) => {
    const messages: {role:string;content:string}[] = [];
    const state: Record<string, any> = { name: `TEST - Kaya Stress Test ${String(index+1).padStart(2,"0")}` };
    const turns: any[] = [];
    for (const m of c.messages) {
      if (m?.role !== "user" || typeof m.content !== "string") continue;
      try {
        const result = planTurn({ ...state, messages }, m.content, {},
          new Date(c.last_message_at || c.created_at || Date.now()));
        Object.assign(state, result.updates);
        state.flow_state = result.state;
        messages.push({role:"user",content:m.content},{role:"assistant",content:result.reply});
        turns.push({customer:m.content,kaya:result.reply,status:result.state.status,
          question:result.state.question,confirm:!!result.confirm});
      } catch (e) {
        turns.push({error:e instanceof Error ? e.message : "Unknown replay error"});
      }
    }
    return { test_name: state.name, source_id: c.id, customer_turns: turns.length,
      booking: state.flow_state?.status === "booked", final_status: state.flow_state?.status,
      errors: turns.filter(t=>t.error).length, turns };
  });
  return NextResponse.json({ mode:"READ_ONLY_REPLAY", external_messages_sent:0,
    crm_leads_created:0, monitor_test_records_created:0,
    conversations:results.length, customer_turns:results.reduce((n,r)=>n+r.customer_turns,0),
    results }, { headers:{"Cache-Control":"no-store"} });
}
