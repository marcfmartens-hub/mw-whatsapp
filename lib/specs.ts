// The country of origin on a Mulkiya does not establish market specifications.
export const MULKIYA_QUESTION = "Could you check the engine number on the Mulkiya, just above the VIN/chassis number? Is there an engine number, or does it say NONE/NIL or appear blank?";

export function specsStatement(text: string, answeringSpecsQuestion = false): "GCC" | "CHECK_MULKIYA" | "Unknown" | null {
  text = text.replace(/\bgcc\s*(?:specs?|spcs)\b/gi, "GCC");
  if (/\b(?:no\s+gcc|us\s+specs?|usa\s+specs?|(?:korean|american|japanese|chinese|european|german|germany|canadian|us|usa)\s+import)\b/i.test(text)
      || answeringSpecsQuestion && /^\s*no\s*[.!]?\s*$/i.test(text)
      || /(?:^|\n)\s*(?:american|korean|japanese|chinese|european)\s*(?:$|\n)/i.test(text)) return "CHECK_MULKIYA";
  if (/\b(don'?t know|do not know|not sure|unsure|no idea|idk|unknown|cannot tell|can't tell)\b/i.test(text) && (answeringSpecsQuestion || /\b(specs?|gcc|origin|mulkiya)\b/i.test(text))) return "Unknown";
  // Only explicit market-spec labels count. A country name or purchase location does not.
  if (/\bnon[\s-]?gcc\b|\b(not|isn'?t|is not)\s+(a\s+)?gcc\b|\b(american|european|japanese|korean|chinese)\s+(specs?|specifications?|version)\b/i.test(text)) return "CHECK_MULKIYA";
  if (answeringSpecsQuestion && /^\s*(american|european|japanese|korean|chinese)\s*[.!]?\s*$/i.test(text)) return "CHECK_MULKIYA";
  if (/\b(?!gcc\b|non\b|american\b|european\b|japanese\b|korean\b|chinese\b)([a-z]+)\s+(specs?|specifications?)\b/i.test(text)) return "Unknown";
  if (/\b(german|french|british|italian|canadian|indian|malaysian|thai|australian|singaporean|saudi|emirati|uae|us|usa|japan|korea|china|germany|france|uk)\s+(version|origin)\b/i.test(text)) return "Unknown";
  // A bare GCC within a car description is a clear market label too ("Camry 2010 GCC").
  // Negations and questions were handled above; a question about GCC is not an answer.
  if (!/\b(what|which|meaning|mean|understand)\b.{0,25}\bgcc\b|\bgcc\b.{0,15}\?/i.test(text) && /\bgcc\b/i.test(text)) return "GCC";
  return null;
}

export function mulkiyaAnswer(text: string): "NON_GCC" | "ENGINE_PRESENT" | "Unknown" {
  // No document or no understanding is not evidence that the engine-number field is blank.
  if (/\b(don'?t|do not|doesn'?t|cannot|can'?t)\s+(have|understand|know|see|check|find)|\b(no|lost|missing|without)\s+(the\s+|my\s+)?(mulkiya|mulkia|registration\s+card)\b|\b(not sure|no idea|unknown)\b/i.test(text)) return "Unknown";
  if (/\b(none|nil|nill|blank|empty|no\s+(engine\s*)?(number|no\.?))\b|\b(not\s+(written|there|shown|listed))\b/i.test(text)) return "NON_GCC";
  if (/^\s*[a-z0-9-]{5,20}\s*$/i.test(text) && /\d/.test(text)) return "ENGINE_PRESENT";
  if (/\b(there\s+is|has|have|shows?|written|present|listed|printed|yes)\b.{0,30}\bengine\s*(number|no\.?)\b|\bengine\s*(number|no\.?)\b.{0,30}\b(there|present|written|listed|printed|yes)\b/i.test(text)) return "ENGINE_PRESENT";
  return "Unknown";
}
