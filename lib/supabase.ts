import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseKey = process.env.SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars");
}

export const supabase = createClient(supabaseUrl, supabaseKey);

export interface Conversation {
  phone: string;
  step: number;
  name: string | null;
  phone_number: string | null;
  alternative_phone?: string | null;
  car: string | null;
  make: string | null;
  model: string | null;
  year: string | null;
  mileage: string | null;
  specs: string | null;
  loan: string | null;
  mortgage_amount: string | null;
  sell_timeline: string | null;
  sell_urgent?: boolean | null;
  appointment: string | null;
  appointment_date: string | null;
  appointment_time: string | null;
  last_msg_id: string | null;
  nudged_at: string | null;
  source_url: string | null;
  last_message_at: string | null;
  bigin_pushed_at: string | null;
  bigin_pending?: string | null;
  processing_until?: string | null;
  estimated_price?: string | null;
  insult_count?: number | null;
  non_gcc_handoff?: boolean | null;
  owner_status?: string | null;
  car_conditions?: string | null;
  inquiry_summary?: string | null;
  price_push_count?: number | null;
  price_handoff_done?: boolean | null;
  price_handoff_collecting?: boolean | null;
  price_handoff_ready?: boolean | null;
  messages?: Array<{ role: "user" | "assistant"; content: string }> | null;
}

const TABLE = "mw_whatsapp";

export async function getConversation(phone: string): Promise<Conversation | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("phone", phone)
    .maybeSingle();

  if (error) {
    console.error("getConversation error:", error);
    throw error;
  }

  return data as Conversation | null;
}

export async function createConversation(phone: string): Promise<Conversation> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ phone, step: 0 })
    .select("*")
    .single();

  if (error) {
    console.error("createConversation error:", error);
    throw error;
  }

  return data as Conversation;
}

export async function getOrCreateConversation(phone: string): Promise<Conversation> {
  const existing = await getConversation(phone);
  if (existing) return existing;
  return createConversation(phone);
}

export async function updateConversation(
  phone: string,
  updates: Partial<Conversation>
): Promise<Conversation> {
  const { data, error } = await supabase
    .from(TABLE)
    .update(updates)
    .eq("phone", phone)
    .select("*")
    .single();

  if (error) {
    console.error("updateConversation error:", error);
    throw error;
  }

  return data as Conversation;
}

// Reset must never fail silently. Strategy:
//  1. Delete the row — next message recreates it clean via getOrCreateConversation.
//  2. If delete is blocked (e.g. RLS), fall back to an update that nulls every field,
//     automatically dropping any column the table doesn't have and retrying.
//  3. Verify the row is actually at step 0 afterwards; throw if not.
export async function resetConversation(phone: string): Promise<void> {
  const del = await supabase.from(TABLE).delete().eq("phone", phone).select("phone");
  if (!del.error) {
    const still = await getConversation(phone).catch(() => null);
    if (!still) return;
  } else {
    console.error("resetConversation delete error (falling back to update):", del.error);
  }

  const fields: Record<string, unknown> = {
      step: 0,
      name: null,
      phone_number: null,
      car: null,
      make: null,
      model: null,
      year: null,
      mileage: null,
      specs: null,
      loan: null,
      mortgage_amount: null,
      sell_timeline: null,
      sell_urgent: null,
      appointment: null,
      appointment_date: null,
      appointment_time: null,
      alternative_phone: null,
      estimated_price: null,
      last_msg_id: null,
      nudged_at: null,
      last_message_at: null,
      bigin_pushed_at: null,
      insult_count: null,
      non_gcc_handoff: null,
      owner_status: null,
      car_conditions: null,
      inquiry_summary: null,
      price_push_count: null,
      price_handoff_done: null,
      price_handoff_collecting: null,
      price_handoff_ready: null,
      messages: [],
  };

  for (let attempt = 0; attempt < 15; attempt++) {
    const { error } = await supabase.from(TABLE).update(fields).eq("phone", phone);
    if (!error) break;
    // PostgREST: "Could not find the 'xyz' column of 'mw_whatsapp' in the schema cache"
    const missing = error.message?.match(/'([a-z_]+)' column/i)?.[1];
    if (missing && missing in fields && missing !== "step") {
      console.warn(`resetConversation: column '${missing}' missing — retrying without it`);
      delete fields[missing];
      continue;
    }
    console.error("resetConversation update error:", error);
    throw error;
  }

  const after = await getConversation(phone);
  if (after && (after.step ?? 0) !== 0) {
    throw new Error(`resetConversation: row for ${phone} still at step ${after.step}`);
  }
}
