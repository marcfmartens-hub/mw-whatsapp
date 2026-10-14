// The country of origin on a Mulkiya does not establish market specifications.
export const MULKIYA_QUESTION = "Could you check the engine number on the Mulkiya, just above the VIN/chassis number? Is there an engine number, or does it say NONE/NIL or appear blank?";

export function specsStatement(text: string, answeringSpecsQuestion = false): "GCC" | "CHECK_MULKIYA" | "Unknown" | null {
  if (/\b(don'?t know|not sure|unsure|no idea|idk|unknown)\b/i.test(text) && /\b(specs?|gcc|origin|mulkiya)\b/i.test(text)) return "Unknown";
  // Only explicit market-spec labels count. A country name or purchase location does not.
  if (/\bnon[\s-]?gcc\b|\b(not|isn'?t|is not)\s+(a\s+)?gcc\b|\b(american|european|japanese|korean|chinese)\s+(specs?|specifications?|version)\b/i.test(text)) return "CHECK_MULKIYA";
  if (answeringSpecsQuestion && /^\s*(american|european|japanese|korean|chinese)\s*[.!]?\s*$/i.test(text)) return "CHECK_MULKIYA";
  if (/\b(?!gcc\b|non\b|american\b|european\b|japanese\b|korean\b|chinese\b)([a-z]+)\s+(specs?|specifications?)\b/i.test(text)) return "Unknown";
  if (/\b(german|french|british|italian|canadian|indian|malaysian|thai|australian|singaporean|saudi|emirati|uae|us|usa|japan|korea|china|germany|france|uk)\s+(version|origin)\b/i.test(text)) return "Unknown";
  if (/\bgcc\s+(specs?|specifications?|version)\b|\b(it'?s|is|yes|actually)\s+gcc\b|^\s*gcc\s*$/i.test(text)) return "GCC";
  return null;
}

export function mulkiyaAnswer(text: string): "NON_GCC" | "ENGINE_PRESENT" | "Unknown" {
  if (/\b(none|nil|nill|blank|empty|missing|no\s+(engine\s*)?(number|no\.?))\b|\b(not\s+(written|there|shown|listed))\b/i.test(text)) return "NON_GCC";
  if (/^\s*[a-z0-9-]{5,20}\s*$/i.test(text) && /\d/.test(text)) return "ENGINE_PRESENT";
  if (/\b(there\s+is|has|have|shows?|written|present|listed|printed|yes)\b.{0,30}\bengine\s*(number|no\.?)\b|\bengine\s*(number|no\.?)\b.{0,30}\b(there|present|written|listed|printed|yes)\b/i.test(text)) return "ENGINE_PRESENT";
  return "Unknown";
}
