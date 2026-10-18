import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET() {
  const { data, error } = await supabase
    .from("mw_whatsapp")
    .select("*")
    .order("last_message_at", { ascending: false, nullsFirst: false });

  if (error) {
    console.error("[conversations] Supabase error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Some inbound chats predate durable activity timestamps. Keep them visible
  // using their creation time without inventing a last-message timestamp.
  const activity = (c: any) => Date.parse(c.last_message_at || `${String(c.created_at).replace(/Z$/, "")}Z`) || 0;
  return NextResponse.json((data ?? []).sort((a, b) => activity(b) - activity(a)));
}
