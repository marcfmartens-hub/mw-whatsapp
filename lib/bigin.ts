import type { Conversation } from "./supabase";

const BIGIN_CONTACTS_URL = "https://www.zohoapis.com/bigin/v1/Contacts";
const ZOHO_TOKEN_URL = "https://accounts.zoho.com/oauth/v2/token";

async function getAccessToken(): Promise<string> {
  const refreshToken = process.env.BIGIN_REFRESH_TOKEN;
  const clientId = process.env.BIGIN_CLIENT_ID;
  const clientSecret = process.env.BIGIN_CLIENT_SECRET;

  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error("Missing BIGIN_REFRESH_TOKEN, BIGIN_CLIENT_ID, or BIGIN_CLIENT_SECRET env vars");
  }

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(`${ZOHO_TOKEN_URL}?${params.toString()}`, {
    method: "POST",
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Zoho token refresh failed: ${res.status} ${errText}`);
  }

  const data = await res.json();

  if (!data.access_token) {
    throw new Error(`Zoho token refresh returned no access_token: ${JSON.stringify(data)}`);
  }

  return data.access_token as string;
}


// ── Field metadata (cached per lambda) — map our values onto Bigin's real fields/types ──
type FieldMeta = { api_name: string; field_label: string; data_type: string; pick_list_values?: { display_value: string; actual_value: string }[] };
let fieldCache: FieldMeta[] | null = null;

async function getContactFields(accessToken: string): Promise<FieldMeta[] | null> {
  if (fieldCache) return fieldCache;
  try {
    const r = await fetch("https://www.zohoapis.com/bigin/v1/settings/fields?module=Contacts", {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });
    if (!r.ok) { console.warn("[Bigin] field metadata unavailable:", r.status, await r.text().catch(() => "")); return null; }
    const j = await r.json();
    fieldCache = (j?.fields ?? []) as FieldMeta[];
    return fieldCache;
  } catch (e) { console.warn("[Bigin] field metadata error:", e); return null; }
}

const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");

// "Saturday", "tomorrow", "10 October", "2026-10-10" → "YYYY-MM-DD" (Dubai time)
function toIsoDate(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const now = new Date(Date.now() + 4 * 3600 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (/\btoday\b/.test(v)) return iso(now);
  if (/\btomorrow\b/.test(v)) return iso(new Date(now.getTime() + 86400000));
  const days = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
  const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  const dm = v.match(/(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s*)?([a-z]{3})/) || null;
  const md = v.match(/([a-z]{3})[a-z]*\s*(\d{1,2})/) || null;
  const dmy = v.match(/(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?/);
  let day: number | null = null, mon: number | null = null;
  if (dm && months.includes(dm[2])) { day = +dm[1]; mon = months.indexOf(dm[2]); }
  else if (md && months.includes(md[1])) { day = +md[2]; mon = months.indexOf(md[1]); }
  else if (dmy) { day = +dmy[1]; mon = +dmy[2] - 1; }
  if (day != null && mon != null) {
    let y = now.getUTCFullYear();
    const cand = new Date(Date.UTC(y, mon, day));
    if (cand.getTime() < now.getTime() - 2 * 86400000) y++;
    return iso(new Date(Date.UTC(y, mon, day)));
  }
  const di = days.findIndex(d => v.includes(d));
  if (di >= 0) {
    let add = (di - now.getUTCDay() + 7) % 7;
    if (add === 0 && /\bnext\b/.test(v)) add = 7;
    return iso(new Date(now.getTime() + add * 86400000));
  }
  return null;
}

// Pick the picklist option that fits a value (exact text, or a numeric range like "25,000 - 50,000")
function matchPicklist(value: string, opts: { display_value: string; actual_value: string }[]): string | null {
  const exact = opts.find(o => norm(o.display_value) === norm(value) || norm(o.actual_value) === norm(value));
  if (exact) return exact.actual_value;
  const n = parseFloat(value.replace(/[^\d.]/g, ""));
  if (isNaN(n)) return null;
  for (const o of opts) {
    const t = o.display_value.toLowerCase().replace(/,/g, "");
    const nums = (t.match(/\d+(?:\.\d+)?\s*k?/g) ?? []).map(x => /k$/.test(x.trim()) ? parseFloat(x) * 1000 : parseFloat(x));
    if (nums.length >= 2 && n >= nums[0] && n <= nums[1]) return o.actual_value;
    if (nums.length === 1 && /(\+|above|over|more)/.test(t) && n >= nums[0]) return o.actual_value;
    if (nums.length === 1 && /(below|under|less|up to)/.test(t) && n <= nums[0]) return o.actual_value;
  }
  return null;
}

// Resolve our keys to Bigin api names (by api name, then by label) and coerce by type.
function adaptRecord(record: Record<string, string>, fields: FieldMeta[] | null): Record<string, unknown> {
  if (!fields) {
    const out: Record<string, unknown> = { ...record };
    if (out["Appointment_Date"]) { const d = toIsoDate(String(out["Appointment_Date"])); if (d) out["Appointment_Date"] = d; else delete out["Appointment_Date"]; }
    return out;
  }
  const byApi = new Map(fields.map(f => [f.api_name, f]));
  const byLabel = new Map(fields.map(f => [norm(f.field_label), f]));
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (raw == null || raw === "") continue;
    const f = byApi.get(key) ?? byLabel.get(norm(key.replace(/_/g, " ")));
    if (!f) { console.warn(`[Bigin] no field for "${key}" — skipped`); continue; }
    let v: unknown = raw;
    switch (f.data_type) {
      case "picklist": v = matchPicklist(String(raw), f.pick_list_values ?? []); break;
      case "integer": case "bigint": { const n = parseInt(String(raw).replace(/[^\d]/g, ""), 10); v = isNaN(n) ? null : n; break; }
      case "double": case "currency": case "decimal": { const n = parseFloat(String(raw).replace(/[^\d.]/g, "")); v = isNaN(n) ? null : n; break; }
      case "date": v = toIsoDate(String(raw)); break;
      case "boolean": v = /^(yes|true|1)$/i.test(String(raw)); break;
    }
    if (v == null) { console.warn(`[Bigin] "${raw}" doesn't fit ${f.api_name} (${f.data_type}) — skipped`); continue; }
    out[f.api_name] = v;
  }
  return out;
}

// Valid Bigin Sales_Inquiry picklist values
const VALID_SALES_INQUIRY = new Set([
  "Cash Deal",
  "Consignment",
  "Not Sure - Need Advise",
  "No Communication yet",
  "Price Offer Inquiry",
  "Home Visit Inquiry",
  "Trade-in Inquiry",
  "Other",
]);

// Maps internal sell_timeline values to Bigin picklist labels
function resolveSalesInquiry(conversation: Conversation & { sales_inquiry?: string }): string {
  const explicit = (conversation as any).sales_inquiry;
  if (explicit && VALID_SALES_INQUIRY.has(explicit)) return explicit;
  const st = (conversation as any).sell_timeline ?? "";
  if (st.includes("cash"))        return "Cash Deal";
  if (st.includes("consignment")) return "Consignment";
  if (st.includes("not_sure"))    return "Not Sure - Need Advise";
  if (st.includes("home_visit"))  return "Home Visit Inquiry";
  if (st.includes("trade_in"))    return "Trade-in Inquiry";
  if (st.includes("price_offer")) return "Price Offer Inquiry";
  // Explicit but unrecognised value → "Other"
  if (explicit) return "Other";
  return "No Communication yet";
}

export async function createBiginContact(
  conversation: Conversation & {
    sales_inquiry?: string;
    alternative_phone?: string;
    inquiry_summary?: string;
    inspection_booked?: boolean;
    owner_status?: string;
    car_conditions?: string;
  },
  attempt = 1
): Promise<boolean> {
  try {
    const accessToken = await getAccessToken();

    // Name: use customer name, fall back to car details, never leave empty
    const carFallback = [conversation.make, conversation.model, conversation.year]
      .filter(Boolean).join(" ");
    const displayName = conversation.name || carFallback || "Unknown";
    // Full name goes into Last_Name only — First_Name is never used
    const lastName = displayName.trim();

    // Phone: always use conversation phone (WhatsApp sender) as primary
    const conversationPhone = (conversation as any).phone_number || (conversation as any).phone || "";
    // Alternative phone: only if explicitly different from conversation phone
    const altPhone = (conversation as any).alternative_phone ?? "";
    const primaryPhone = altPhone && altPhone !== conversationPhone ? altPhone : conversationPhone;

    const record: Record<string, string> = {
      Last_Name: lastName,
      Phone: primaryPhone || conversationPhone,
      Conversation_Phone_Number: conversationPhone,
      Lead_Source: "WhatsApp Bot",
      Source_Url: "WhatsApp Bot",
      Sales_Inquiry: resolveSalesInquiry(conversation as any),
    };

    // Inspection_Booked: Yes if appointment confirmed, No otherwise
    record["Inspection_Booked"] = conversation.inspection_booked ? "Yes" : "No";

    if (conversation.make)             record["Make"]             = conversation.make;
    if (conversation.model)            record["Model"]            = conversation.model;
    if (conversation.year)             record["Year"]             = conversation.year;
    if (conversation.mileage)          { record["Mileage"] = conversation.mileage; record["Mileage_Range"] = conversation.mileage; }
    if (conversation.specs)            record["Regional_Specs"]   = conversation.specs;
    if (conversation.appointment_date) record["Appointment_Date"] = conversation.appointment_date;
    if (conversation.appointment_time) record["Appointment_Time"] = conversation.appointment_time;
    if (conversation.estimated_price)  record["Estimated_Price"]  = conversation.estimated_price;
    if (conversation.owner_status)     record["Owner_Status"]     = conversation.owner_status;
    if (conversation.car_conditions)   record["Car_Conditions"]   = conversation.car_conditions;
    if (conversation.inquiry_summary)  record["Inquiry_Summary"]  = conversation.inquiry_summary;

    const headers = {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      "Content-Type": "application/json",
    };

    // Upsert: find existing contact by the WhatsApp number, update it; otherwise create.
    // Lets us push at every milestone (follow-up, booking, timeout) without duplicates.
    let existingId: string | null = null;
    if (conversationPhone) {
      const sr = await fetch(`${BIGIN_CONTACTS_URL}/search?phone=${encodeURIComponent(conversationPhone)}`, { headers });
      if (sr.status === 200) {
        const sj = await sr.json().catch(() => null);
        existingId = sj?.data?.[0]?.id ?? null;
      } else if (sr.status !== 204) {
        console.warn("[Bigin] search failed:", sr.status, await sr.text().catch(() => ""));
      }
    }

    const fields = await getContactFields(accessToken);
    const data = adaptRecord(record, fields);

    // If Bigin rejects a field (INVALID_DATA etc.), drop just that field and retry —
    // one bad value must never cost us the whole record.
    let text = "";
    for (let tries = 0; tries < 6; tries++) {
      const body = JSON.stringify({ data: [existingId ? { id: existingId, ...data } : data] });
      console.log(`[Bigin] ${existingId ? "updating " + existingId : "creating"}:`, body);
      const res = await fetch(BIGIN_CONTACTS_URL, { method: existingId ? "PUT" : "POST", headers, body });
      text = await res.text();
      const result = (() => { try { return JSON.parse(text); } catch { return null; } })();
      const row = result?.data?.[0];
      if (res.ok && (!row?.status || row.status === "success")) break;
      const bad = row?.details?.api_name as string | undefined;
      if (bad && bad in data) {
        console.warn(`[Bigin] field ${bad} rejected (${row?.code}: ${row?.message}) — retrying without it`);
        delete data[bad];
        continue;
      }
      throw new Error(`Bigin ${existingId ? "update" : "create"} failed: ${res.status} ${text}`);
    }
    console.log(`[Bigin] contact ${existingId ? "updated" : "created"}:`, text);
    return true;
  } catch (error) {
    if (attempt < 3) {
      console.warn(`[Bigin] attempt ${attempt} failed, retrying in 3s...`);
      await new Promise(r => setTimeout(r, 3000));
      return createBiginContact(conversation, attempt + 1);
    }
    console.error("Bigin contact creation error (all retries failed):", error);
    return false;
  }
}
