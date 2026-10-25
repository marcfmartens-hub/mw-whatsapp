/**
 * Five-stage, booking-first conversation quality layer.
 * The deterministic booking and vehicle-specification rules remain authoritative.
 * Never changes a confirmed booking, CRM action, or verified non-GCC restriction.
 */
export type ContextMemory = {
  urgency?: boolean;
  relocation?: boolean;
  jobLoss?: boolean;
  acknowledgedUrgency?: boolean;
  repeatedQuestions?: number;
  lastCustomerIntent?: string;
  lastPrompts?: string[];
};
export type Interpretation = {
  urgency: boolean;
  relocation: boolean;
  jobLoss: boolean;
  acknowledgement: boolean;
  questionAnswered: boolean;
  intent: string;
};
const normalize=(s:string)=>s.toLowerCase().replace(/[’‘]/g,"'").replace(/[^a-z0-9]+/g," ").trim();
const relocation=/\b(?:leav(?:e|ing) (?:dubai|uae|the country)|going (?:back )?to (?:india|my country|home)|moving (?:abroad|away)|flying (?:back|home))\b/i;
const jobLoss=/\b(?:lost my job|lost the job|job loss|made redundant|terminated from (?:my )?job)\b/i;
const urgency=/\b(?:urgently|urgent|asap|immediately|sell (?:today|tomorrow|quickly)|need (?:to sell|cash) (?:quickly|now|today))\b/i;
const affirmative=/^\s*(?:yes|yeah|yep|ok|okay|sure|alright|fine|please|sounds good)[\s.!]*$/i;
const questionLike=/\?|\b(?:what|which|when|where|would you|could you|may i|is it|does the|do you)\b/i;
export function understandCustomer(text:string, expectedQuestion:string):Interpretation {
  const r=relocation.test(text), j=jobLoss.test(text), u=urgency.test(text)||r||j;
  const acknowledgement=affirmative.test(text);
  return {urgency:u,relocation:r,jobLoss:j,acknowledgement,
    questionAnswered:acknowledgement||!!expectedQuestion&&text.trim().length>0,
    intent:r?"relocating":j?"job_loss":u?"urgent_sale":acknowledgement?"affirmative":"information"};
}
export function extractContext(previous:ContextMemory|undefined, interpretation:Interpretation):ContextMemory {
  return {...previous,urgency:!!previous?.urgency||interpretation.urgency,
    relocation:!!previous?.relocation||interpretation.relocation,
    jobLoss:!!previous?.jobLoss||interpretation.jobLoss,
    lastCustomerIntent:interpretation.intent};
}
export function sameQuestion(a:string,b:string):boolean {
  if(!a||!b)return false;
  const x=normalize(a),y=normalize(b);
  if(x===y)return true;
  // Ignore a prefixed acknowledgement while comparing the actual question.
  const lastQuestion=(s:string)=>normalize(s.split(/[?]/).slice(-2,-1)[0]||s);
  return questionLike.test(a)&&questionLike.test(b)&&lastQuestion(a)===lastQuestion(b);
}
export function decideNextResponse(args:{
  proposed:string; previous:string; customer:string; question?:string; status:string;
  memory:ContextMemory; interpretation:Interpretation;
}):{reply:string;memory:ContextMemory;reason:string} {
  const {proposed,previous,customer,status,interpretation}=args;
  const memory={...args.memory};
  // Never rewrite committed bookings, team handovers, verified non-GCC decisions, or cancellations.
  if(["booked","default_pending","reconfirmation","team_accepted","customer_will_contact","closed"].includes(status)
    ||/\b(?:non-gcc|mulkiya|engine.number|not available|outside an available|please confirm before i book|you're booked|i've booked)\b/i.test(proposed))
    return {reply:proposed,memory,reason:"protected_business_rule"};
  const recent=memory.lastPrompts??[];
  const duplicate=sameQuestion(previous,proposed)||recent.some(p=>sameQuestion(p,proposed));
  if(duplicate)memory.repeatedQuestions=(memory.repeatedQuestions||0)+1;
  else memory.repeatedQuestions=0;
  let reply=proposed;
  let reason=duplicate?"repeat_prevented":"original_flow";
  if(duplicate) {
    // Keep the original appointment-first goal, but stop asking the identical question.
    if(/\b(?:what time|exact arrival time|what exact|bring your car)\b/i.test(proposed)){
      reply=(memory.repeatedQuestions===1)
        ?"To make this easy, would you prefer a morning or afternoon inspection at our Al Quoz branch?"
        :"If choosing a time is difficult, our purchasing team can call you to arrange your free inspection. Would you prefer a call?";
    } else if(/\b(?:which day|when are you planning|when would you)\b/i.test(proposed)){
      reply=memory.repeatedQuestions===1
        ?"Would tomorrow work for a free inspection at our Al Quoz branch, or would another day suit you better?"
        :"If you're not sure about the day yet, would you prefer a call from our team to arrange it?";
    } else {
      reply="Thanks for the information. We can arrange a free inspection at our Al Quoz branch. Which day would suit you?";
    }
  }
  if(interpretation.urgency&&!memory.acknowledgedUrgency){
    const empathy=interpretation.jobLoss
      ?"I'm sorry to hear about your job situation. We can help you arrange a quick, free inspection."
      :interpretation.relocation
      ?"I understand you're leaving the UAE and want to sell your car soon. We can help arrange a quick, free inspection."
      :"I understand you'd like to sell quickly. We can help with a free inspection.";
    reply=empathy+" "+reply;
    memory.acknowledgedUrgency=true;
    reason=duplicate?"urgent_context_and_repeat_prevented":"urgent_context";
  }
  // A simple yes/okay must not be interpreted as an agreed booking date/time.
  if(interpretation.acknowledgement&&/\b(?:you're booked|booking confirmed)\b/i.test(reply)){
    reply="Thanks. What day and time would you like to come to our Al Quoz branch for the free inspection?";
    reason="prevent_unconsented_booking";
  }
  // Compare against several recent assistant replies to stop A-B-A-B loops.
  memory.lastPrompts=[...recent,reply].slice(-6);
  return {reply,memory,reason};
}
