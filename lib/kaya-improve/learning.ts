import saved from "./learning.json";
export type Intent="customer_will_call"|"request_number";
export interface Alias { phrase:string; intent:Intent }
export interface Learning { version:1; aliases:Alias[] }
export const TARGETS:Record<Intent,string>={customer_will_call:"I will call you",request_number:"send me your number"};
export const normalizePhrase=(s:string)=>s.toLowerCase().trim().replace(/[’]/g,"'").replace(/[.!?,]+$/g,"").replace(/\s+/g," ");
export function validateLearning(value:unknown):Learning {
 const c=value as Learning;
 if(!c||c.version!==1||!Array.isArray(c.aliases)||c.aliases.length>100)throw Error("Invalid learning catalog");
 const seen=new Set<string>();
 const aliases=c.aliases.map(a=>{
  if(!a||Object.keys(a).sort().join(',')!=="intent,phrase"||typeof a.phrase!=="string"||!["customer_will_call","request_number"].includes(a.intent))throw Error("Only contact-language aliases are allowed");
  const phrase=normalizePhrase(a.phrase);
  if(phrase.length<6||phrase.length>100||!/^[a-z '\-]+$/.test(phrase)||/\b(not|dont|don't|never|stop|cancel|book|appointment|inspection|reschedule|price|pay|if|unless|maybe|might|can|could|would|should|later|tomorrow)\b/.test(phrase))throw Error("Ambiguous, conditional or business-rule language cannot be learned automatically");
  // Contact directions may not be inferred from general requests or customer data.
  if(a.intent==="customer_will_call"&&!/^(?:i|im|i'm|ill|i'll|i will|me) (?:will |am |going to )?(?:call|phone|ring|contact) (?:to )?(?:you|u|your team)$/.test(phrase))throw Error("Customer-call alias must explicitly say the customer will call us");
  if(a.intent==="request_number"&&!/^(?:send|give|share|text|pls send|please send|please give|pls give) (?:me )?(?:your|ur|the|customer service) (?:phone |mobile |contact )?(?:number|no)$/.test(phrase))throw Error("Number alias must explicitly request our number");
  if(seen.has(phrase))throw Error("Duplicate phrase");seen.add(phrase);return{phrase,intent:a.intent};
 });
 return{version:1,aliases};
}
export function learnedMessage(text:string,catalog:Learning=validateLearning(saved)):string {
 const alias=catalog.aliases.find(a=>a.phrase===normalizePhrase(text));return alias?TARGETS[alias.intent]:text;
}
export function validateCandidate(before:Learning,after:Learning,successfulMessages:string[]) {
 validateLearning(after);
 for(const entry of before.aliases)if(!after.aliases.some(a=>a.phrase===entry.phrase&&a.intent===entry.intent))throw Error("Automatic updates can only add aliases");
 const added=after.aliases.filter(a=>!before.aliases.some(b=>b.phrase===a.phrase));
 if(!added.length||added.length>5)throw Error("A batch must add 1–5 aliases");
 const protectedInputs=["Call","Ali","Please call me","I will call you","send me your number","Do not call me","No callback thanks","Book Saturday at 3 PM","Saturday morning","GCC","German specs","NONE","I'll let you know","If you can pay 75000 I will come",...successfulMessages];
 for(const text of protectedInputs)if(learnedMessage(text,before)!==learnedMessage(text,after))throw Error("Candidate changes a protected successful conversation or locked-rule example");
 return{passed:true,protected_messages:protectedInputs.length,added:added.length};
}
