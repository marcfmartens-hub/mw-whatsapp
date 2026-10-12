import { createClient } from "@supabase/supabase-js";

// Separate client for Supabase Auth emails (password reset links). Implicit flow so the
// link lands on our reset page with the access token in the URL hash.
export function authClient() {
  return createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_ANON_KEY as string, {
    auth: { persistSession: false, autoRefreshToken: false, flowType: "implicit" },
  });
}
