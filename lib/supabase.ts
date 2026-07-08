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
  car: string | null;
  make: string | null;
  model: string | null;
  year: string | null;
  mileage: string | null;
  specs: string | null;
  loan: string | null;
  mortgage_amount: string | null;
  sell_timeline: string | null;
  appointment: string | null;
  appointment_date: string | null;
  appointment_time: string | null;
  last_msg_id: string | null;
  nudged_at: string | null;
  source_url: string | null;
  last_message_at: string | null;
  bigin_pushed_at: string | null;
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

export async function resetConversation(phone: string): Promise<void> {
  // Core columns — guaranteed to exist
  const { error } = await supabase
    .from(TABLE)
    .update({
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
      appointment: null,
      last_msg_id: null,
    })
    .eq("phone", phone);

  if (error) {
    console.error("resetConversation error:", error);
    throw error;
  }

  // Optional columns — added via migration; fail silently if missing
  await supabase.from(TABLE).update({
    mortgage_amount: null,
    sell_timeline: null,
    appointment_date: null,
    appointment_time: null,
    nudged_at: null,
    messages: [],
    bigin_pushed_at: null,
    last_message_at: null,
  }).eq("phone", phone);
}
