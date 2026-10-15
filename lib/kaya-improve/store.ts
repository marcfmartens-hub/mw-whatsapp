import { createClient } from "@supabase/supabase-js";
import { DEFAULT_CONFIG, validateConfig } from "./config";
export function improveDb() {
  const secret = process.env.KAYA_IMPROVE_SECRET;
  if (!secret) throw new Error("Kaya Improve storage connection is not configured");
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-kaya-improve-secret": secret }, fetch: (input,init)=>fetch(input,{...init,cache:"no-store"}) },
  });
}
export async function settings() {
  const db=improveDb();
  const {data,error}=await db.from("mw_improve_settings").select("*").eq("id",true).single();
  if(error) throw new Error(error.message);
  return { ...data, config:validateConfig(data.config ?? DEFAULT_CONFIG) };
}
