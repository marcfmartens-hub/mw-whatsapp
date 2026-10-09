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
    const [firstName, ...rest] = displayName.trim().split(/\s+/);
    const lastName = rest.length > 0 ? rest.join(" ") : firstName;

    // Phone: always use conversation phone (WhatsApp sender) as primary
    const conversationPhone = (conversation as any).phone_number || (conversation as any).phone || "";
    // Alternative phone: only if explicitly different from conversation phone
    const altPhone = (conversation as any).alternative_phone ?? "";
    const primaryPhone = altPhone && altPhone !== conversationPhone ? altPhone : conversationPhone;

    const record: Record<string, string> = {
      First_Name: firstName,
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
    if (conversation.mileage)          record["Mileage_Range"]    = conversation.mileage;
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

    const body = JSON.stringify({ data: [existingId ? { id: existingId, ...record } : record] });
    console.log(`[Bigin] ${existingId ? "updating " + existingId : "creating"}:`, body);

    const res = await fetch(BIGIN_CONTACTS_URL, { method: existingId ? "PUT" : "POST", headers, body });
    const text = await res.text();
    const result = (() => { try { return JSON.parse(text); } catch { return null; } })();
    const rowStatus = result?.data?.[0]?.status;

    if (!res.ok || (rowStatus && rowStatus !== "success")) {
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
