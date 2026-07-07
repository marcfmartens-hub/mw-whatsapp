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

export async function createBiginContact(conversation: Conversation): Promise<void> {
  try {
    const accessToken = await getAccessToken();

    const [firstName, ...rest] = (conversation.name || "Customer").trim().split(/\s+/);
    const lastName = rest.length > 0 ? rest.join(" ") : firstName;

    const record: Record<string, string> = {
      First_Name: firstName,
      Last_Name: lastName,
      Phone: conversation.phone_number || conversation.phone,
      Lead_Source: "WhatsApp Bot",
    };

    if (conversation.make)             record["Make"]             = conversation.make;
    if (conversation.model)            record["Model"]            = conversation.model;
    if (conversation.year)             record["Year"]             = conversation.year;
    if (conversation.mileage)          record["Mileage"]          = conversation.mileage;
    if (conversation.specs)            record["Regional_Specs"]   = conversation.specs;
    if (conversation.loan)             record["Mortgage"]         = conversation.loan;
    if (conversation.mortgage_amount)  record["Mortgage_Amount"]  = conversation.mortgage_amount;
    if (conversation.appointment_date) record["Appointment_Date"] = conversation.appointment_date;
    if (conversation.appointment_time) record["Appointment_Time"] = conversation.appointment_time;

    const payload = { data: [record] };

    console.log("[Bigin] sending payload:", JSON.stringify(payload));

    const res = await fetch(BIGIN_CONTACTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Bigin contact creation failed:", res.status, errText);
      return;
    }

    const result = await res.json();
    console.log("Bigin contact created:", JSON.stringify(result));
  } catch (error) {
    console.error("Bigin contact creation error:", error);
  }
}
