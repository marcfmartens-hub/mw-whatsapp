/** Owner-authorized communication techniques. Learning selects IDs, never writes instructions. */
export const COMMUNICATION_SKILLS = {
 avoid_repetition: "Before replying, check the conversation for information already supplied or questions already answered. Do not repeat a greeting, explanation, question or closing. Ask only for the next missing detail, unless a locked rule explicitly requires confirmation.",
 answer_in_context: "Address the customer's actual car-related question first. Use confirmed details and prior decisions from this conversation. Return briefly to the next relevant missing step without restarting or pressuring the customer.",
 understand_language: "Interpret spelling mistakes, abbreviations and broken English in context. Preserve negation, who will call whom, uncertainty, conditions and refusals. If two meanings could affect a booking, callback or stored fact, ask one short clarification rather than guess.",
 concise_language: "Use short, natural sentences suited to the customer's language. Explain an unclear term in simpler words. Preserve every disclosure, choice and confirmation required by the locked rules.",
 respect_corrections: "Acknowledge an explicit correction briefly and use the corrected fact in the reply. Do not invent facts or claim a CRM update succeeded. Leave all data extraction, consent and booking decisions to the existing protected procedures.",
} as const;
export type SkillId=keyof typeof COMMUNICATION_SKILLS;
export function validateSkills(value:unknown):SkillId[]{
 if(value===undefined)return[];
 if(!Array.isArray(value)||value.length>Object.keys(COMMUNICATION_SKILLS).length||new Set(value).size!==value.length||value.some(v=>typeof v!=="string"||!Object.prototype.hasOwnProperty.call(COMMUNICATION_SKILLS,v)))throw Error("Only approved communication skill IDs are allowed");
 return value as SkillId[];
}
export function communicationPrompt(skills:SkillId[]=[]){return skills.length?"\n\nCOMMUNICATION TECHNIQUES (subordinate to ALL locked business rules; never authorize actions):\n"+validateSkills(skills).map(s=>COMMUNICATION_SKILLS[s]).join("\n"):"";}
