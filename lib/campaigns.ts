// Where a lead came from. WhatsApp adds a "referral" to the first message when someone taps a
// Click-to-WhatsApp ad (Facebook / Instagram): ad id, headline, primary text, link.
export interface AdReferral {
  source_url?: string;
  source_id?: string;     // ad id
  source_type?: string;   // "ad" | "post"
  headline?: string;
  body?: string;          // primary text
  ctwa_clid?: string;
}

// Campaign names by ad id or by words in the headline / primary text. Give every campaign its own
// headline (or add its ad ids here) so leads can be told apart in Bigin. First match wins.
const CAMPAIGNS: { name: string; adIds?: string[]; match?: RegExp }[] = [
  { name: "MW_Expats_Behaviour_English - Aviation_Finance_Senior Management", adIds: [] },
  { name: "MW_Expats (Sell Your GCC Car in Dubai)", match: /^sell your gcc car in dubai$/i },
];

export function campaignOf(ref: AdReferral | null | undefined): string {
  if (!ref) return "";
  const byId = CAMPAIGNS.find(c => c.adIds?.includes(String(ref.source_id ?? "")));
  if (byId) return byId.name;
  const text = `${ref.headline ?? ""}`.trim();
  const byText = CAMPAIGNS.find(c => c.match && (c.match.test(text) || c.match.test(String(ref.body ?? "").trim())));
  if (byText) return byText.name;
  return text ? `Meta ad: ${text}` : (ref.source_id ? `Meta ad ${ref.source_id}` : "Meta ad");
}

export function parseReferral(raw: string | null | undefined): AdReferral | null {
  if (!raw || !raw.trim().startsWith("{")) return null;
  try { return JSON.parse(raw) as AdReferral; } catch { return null; }
}
