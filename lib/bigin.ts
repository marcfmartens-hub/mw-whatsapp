import type { Conversation } from "./supabase";

const BIGIN_CONTACTS_URL = "https://www.biginapp.com/bigin/v1/Contacts";

export async function createBiginContact(conversation: Conversation): Promise<void> {
  const accessToken = process.env.BIGIN_ACCESS_TOKEN;

  if (!accessToken) {
    console.error("Missing BIGIN_ACCESS_TOKEN env var — skipping Bigin contact creation");
    return;
  }

  const [firstName, ...rest] = (conversation.name || "Customer").trim().split(/\s+/);
  const lastName = rest.length > 0 ? rest.join(" ") : firstName;

  const payload = {
    data: [
      {
        First_Name: firstName,
        Last_Name: lastName,
        Phone: conversation.phone_number || conversation.phone,
        Description: [
          `Car: ${conversation.car || "N/A"}`,
          `Mileage: ${conversation.mileage || "N/A"}`,
          `Spec: ${conversation.gcc_spec || "N/A"}`,
          `Loan on car: ${conversation.loan || "N/A"}`,
          `Appointment: ${conversation.appointment || "N/A"}`,
        ].join("\n"),
      },
    ],
  };

  try {
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
