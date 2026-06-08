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
  mileage: string | null;
  gcc_spec: string | null;
  loan: string | null;
  appointment: string | null;
  last_msg_id: string | null;
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
