import Anthropic from "@anthropic-ai/sdk";
import { checkResponse, classifyIntent, type Memory, type V3Result } from "./engine";
import { KAYA_V3_RULES } from "./rules";

const SYSTEM = `You are Kaya V3, the WhatsApp assistant for Mister Wheelz, a car buyer in Dubai.
Your main objective is to help a seller book a FREE, NO-OBLIGATION, IN-OFFICE inspection; secondary objective is to arrange a callback if they prefer. Respond naturally, briefly, in the customer's language, usually one question per message.
Answer the customer's actual question FIRST. Remember details already given; never ask for a name more than once if ignored. Recognize corrections, multi-part messages, hesitation, buyer inquiries, urgent sellers and "I will call you" versus "call me".
HARD RULES: Never invent an appointment, callback, price, address, phone number, or completed action. NEVER give any price or estimate by phone. Final offer only after inspection. NO HOME VISITS. Closed Sundays. Cars only; no politics or religion. Stop contacting a customer who opts out. If customer says they are busy or will contact us, acknowledge and stop pushing. A buyer inquiry must not enter the seller flow. Confirmed non-GCC specifications must go to a human; if specs are uncertain, continue without guessing. If customer asks for a person, offer handover.
THIS IS A SIMULATED TEST CHAT. You have NO access to booking availability, CRM or live WhatsApp. Never say "booked", "scheduled", "I've arranged a callback", "I'll send a message" or imply anything was saved. Instead say you can help collect details for the team, or ask a preferred day/time. Never invent contact/location facts.
Respond ONLY as valid JSON with keys: "intent" (one of stop,self_contact,human,buyer,price,booking,callback,seller,question,unknown), "reply" (short customer-facing response), "facts" (object with any confirmed name,make,model,year,mileage,specs), "reason" (short explanation of what you understood). No markdown.`;
const client = new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY});
export async function aiV3Turn(previous: Memory, input: string): Promise<V3Result & {reason:string;engine:string}> {
  const memory: Memory = {...previous,messages:[...(previous.messages||[]).slice(-30)]};
  const fallbackIntent = classifyIntent(input);
  if (memory.stopped) return {intent:"stop",reply:"",memory,action:"none",violations:[],reason:"Previous opt-out respected",engine:"kaya-v3-ai"};
  const history = memory.messages.slice(-18).filter(m=>["user","assistant"].includes(m.role) && typeof m.content==="string").map(m=>({role:m.role,content:m.content.slice(0,1500)}));
  const result = await client.messages.create({
    model:"claude-haiku-5-5",max_tokens:650,temperature:0,
    system:SYSTEM,
    messages:[...history,{role:"user",content:`CURRENT CUSTOMER MESSAGE: ${input.slice(0,2000)}\nKNOWN FACTS: ${JSON.stringify({name:memory.name,make:memory.make,model:memory.model,year:memory.year,mileage:memory.mileage,specs:memory.specs,ignoredName:memory.ignoredName})}`}]
  });
  const text = result.content.filter(c=>c.type==="text").map(c=>c.text).join("").trim();
  let parsed: {intent?:string;reply?:string;facts?:Record<string,unknown>;reason?:string};
  try { parsed=JSON.parse(text.replace(/^\`\`\`(?:json)?\s*|\s*\`\`\`$/g,"")); }
  catch {throw Error("AI returned invalid JSON");}
  const validIntents=["stop","self_contact","human","buyer","price","booking","callback","seller","question","unknown"];
  const intent=(validIntents.includes(parsed.intent||"")?parsed.intent:fallbackIntent) as V3Result["intent"];
  let reply=typeof parsed.reply==="string"?parsed.reply.trim().slice(0,900):"";
  if(!reply) throw Error("AI returned empty reply");
  const facts=parsed.facts && typeof parsed.facts==="object" ? parsed.facts : {};
  for(const key of ["name","make","model","year","mileage"] as const){
    const v=facts[key]; if(typeof v==="string" && v.length<80 && v.trim()) memory[key]=v.trim();
  }
  if(["GCC","Non-GCC","Unknown"].includes(String(facts.specs))) memory.specs=facts.specs as Memory["specs"];
  if(memory.lastQuestion==="name" && !memory.name) memory.ignoredName=true;
  if(intent==="stop") {memory.stopped=true;reply="Understood. We won't contact you again unless you contact us.";}
  if(intent==="self_contact") reply="Of course, take your time. Message us whenever you're ready.";
  const violations=checkResponse(input,reply,memory);
  if(/\b(?:you're booked|you are booked|appointment (?:is|has been) (?:confirmed|booked)|i(?:'ve| have) (?:booked|scheduled)|callback (?:is|has been) (?:arranged|scheduled))\b/i.test(reply)) violations.push("UNVERIFIED_ACTION");
  if(/\b(?:we(?:'ll| will| can) (?:come|visit) (?:your|to your) (?:home|house))\b/i.test(reply)) violations.push("HOME_VISIT");
  if(memory.specs==="Non-GCC" && /\b(?:booked|confirmed appointment)\b/i.test(reply)) violations.push("NON_GCC_BOOKING");
  if(violations.length){reply="I can help you with the next steps, or arrange for our team to assist. Would you prefer a callback?";}
  memory.lastQuestion=/\b(?:your name|may i (?:know|have) your name)\b/i.test(reply)?"name":undefined;
  memory.messages.push({role:"user",content:input},{role:"assistant",content:reply});
  const action:V3Result["action"]=intent==="human"||intent==="callback"||intent==="buyer"?"handover_requested":intent==="booking"?"booking_requested":"none";
  return {intent,reply,memory,action,violations,reason:typeof parsed.reason==="string"?parsed.reason.slice(0,250):"",engine:"kaya-v3-ai"};
}
