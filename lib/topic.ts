// Only divert a standalone unrelated question. A message about the car takes priority.
export function isStandaloneOffTopicQuestion(message: string): boolean {
  const carContext = /\b(car|vehicle|sell|selling|buy|buyer|offer|price|cash|consign|inspection|appointment|booking|dealer|competitor|specs|mileage|loan|mulkiya|location|address|wheelz)\b/i;
  if (carContext.test(message)) return false;
  return /\b(politics?|political|politicians?|elections?|vote|voting|president|prime minister|government|religion|religious|god|allah|islam|muslim|christian|christianity|hinduism|hindu|buddhism|buddhist|atheis\w*|quran|bible)\b/i.test(message)
    && /\b(what|who|why|how|which|should|do you|is it|are you|tell me|think|believe|opinion)\b|\?/i.test(message);
}

export function asksBestWayToSell(message: string): boolean {
  return /\b(best|better|right)\s+(way|option|method|approach)\s+(to\s+)?sell\b|\b(how should i sell|cash or consignment|consignment or cash|which is better.*(?:cash|consign)|(?:cash|consign).*which is better)\b/i.test(message);
}

export function isUnsureAboutSellingOption(message: string): boolean {
  return /^(?:i(?:'m| am)?\s+)?(?:not sure|unsure|don'?t know|no idea|either|maybe|depends)(?:\s+(?:yet|which|about (?:the )?options?))?[.!?\s]*$/i.test(message.trim());
}

export function isSellingOptionAnswer(message: string): boolean {
  if (/\b(not ready to (?:book|come|visit)|don'?t want to (?:book|come|visit)|no (?:booking|appointment))\b/i.test(message)) return false;
  return isUnsureAboutSellingOption(message)
    || /\b(quick cash|cash payment|cash option|direct sale|consign(?:ment)?|higher (?:return|amount|price)|more money|quick transfer|sell (?:it )?(?:quickly|fast)|(?:can|could|happy to) wait|(?:have|got|need) (?:at least )?3\s*[-/]\s*4 weeks|(?:in|after) (?:three|four|3|4) weeks)\b/i.test(message);
}
