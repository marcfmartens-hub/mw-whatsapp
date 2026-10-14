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
