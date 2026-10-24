export interface Chat { phone: string; last_message_at?:string|null; name?: string | null; step?: number; appointment_date?: string | null; appointment_time?: string | null; bigin_pushed_at?: string | null; car_conditions?: string | null; messages?: {role: string; content: string}[] | null }
export interface Finding { code: string; severity: "warning" | "critical"; message: string; evidence: string; suggestion: string }
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
export function detect(chat: Chat) {
  const messages = chat.messages ?? [];
  const assistants = messages.filter(m => m.role === "assistant");
  const users = messages.filter(m => m.role === "user");
  const findings: Finding[] = [];
  const add = (code: string, severity: Finding["severity"], message: string, evidence: string, suggestion: string) => findings.push({code, severity, message, evidence: evidence.slice(0, 500), suggestion});
  if (/^(call|callback|phone|number|contact|ring)$/i.test(chat.name ?? "")) add("invalid_name", "critical", "A contact word was stored as a name", chat.name!, "Ask for the customer's name; never infer it from a call request.");
  for (let i = 1; i < assistants.length; i++) {
    if (normalize(assistants[i].content).length > 15 && normalize(assistants[i].content) === normalize(assistants[i-1].content)) {
      add("repeated_reply", "warning", "The same reply was repeated", assistants[i].content, "Use information already supplied and ask only for a missing detail."); break;
    }
  }
  // Detect semantic question loops, including paraphrases and non-adjacent repeats.
  // The detector only reports findings; business-policy changes remain approval-locked.
  const questionKind = (s: string): string | null => {
    if (/\b(?:what|which).*\b(?:year|model year)|car'?s year/i.test(s)) return "year";
    if (/\b(?:mileage|kilomet(?:er|re)s?|how many km)\b/i.test(s)) return "mileage";
    if (/\b(?:gcc|specs|specifications)\b/i.test(s) && /\?|\b(?:is it|are you|unsure)\b/i.test(s)) return "specs";
    if (/\b(?:your name|may i know your name)\b/i.test(s)) return "name";
    if (/\b(?:what time|arrival time|exact time)\b/i.test(s)) return "time";
    return null;
  };
  const seenQuestions = new Map<string, number>();
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const kind = questionKind(m.content);
    if (!kind) continue;
    const earlier = seenQuestions.get(kind);
    if (earlier !== undefined) {
      const between = messages.slice(earlier + 1, i).filter(x => x.role === "user").map(x => x.content).join(" ");
      if (between && kind === "specs" && /\b(?:unsure|not sure|don'?t know|do not know|no idea|idk|unknown)\b/i.test(between)) {
        add("question_after_unknown", "warning", "Specs question repeated after the customer said they do not know", between + " → " + m.content, "Mark specs Unknown and continue.");
      } else if (between && (i - earlier > 2 || !/\b(?:clarify|could you clarify|prefer our team)\b/i.test(m.content))) {
        add("question_loop", "warning", "The same information was requested again", messages[earlier].content + " → " + m.content, "Use question history, extract all supplied facts and offer assistance after one clarification.");
      }
    }
    seenQuestions.set(kind, i);
  }
  const booking = assistants.find(m => /you'?re booked for|your (?:appointment|booking) is confirmed/i.test(m.content));
  const hasSlot = !!(chat.appointment_date && chat.appointment_time);
  if (booking && !hasSlot) add("unsaved_booking", "critical", "A booking was confirmed without a stored date and time", booking.content, "Verify the appointment save before sending confirmation.");
  if (hasSlot && booking) {
    const before = messages.slice(0, messages.indexOf(booking)).filter(m => m.role === "user").map(m => m.content).join(" ");
    if (!/\b(book|inspection|appointment|come|coming|visit|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|weekend|\d{1,2}\s*(?:am|pm))\b/i.test(before)) add("consent_review", "warning", "Booking agreement needs manual verification", before, "Check the actual customer agreement; keyword evidence is not proof of consent.");
    if (chat.appointment_date && new Date(`${chat.appointment_date}T12:00:00Z`).getUTCDay() === 0) add("sunday_booking", "critical", "Stored appointment is on Sunday", chat.appointment_date, "Check the approved opening calendar and correct through the team.");
    if (/:15(?:\s|$)/.test(chat.appointment_time ?? "") && !/exact (?:time|timing)|call cent(?:re|er).*confirm/i.test(booking.content + assistants.map(m=>m.content).join(" "))) add("fallback_explanation", "warning", "A :15 appointment may be missing its fallback explanation", booking.content, "Verify the customer selected the time or received the approved fallback explanation.");
    if (!chat.bigin_pushed_at) add("crm_unverified", "warning", "CRM handover is not recorded", booking.content, "Verify the linked Bigin booking event. A push timestamp alone does not prove the event exists.");
  }
  for (let i=0; i<messages.length; i++) {
    const m=messages[i];
    if (m.role!=="assistant" || !/\b(?:our team|someone from our team|we)\b.{0,35}\b(?:will call|will contact|will be in touch|will get back)/i.test(m.content)) continue;
    const preceding=messages.slice(0,i).filter(x=>x.role==="user").map(x=>x.content);
    const last=preceding[preceding.length-1]??"";
    if (/\b(?:i'?ll|i will|im|i'?m)\s+call\s+you\b/i.test(last) && !/\bcall me|please call|call back\b/i.test(last)) add("callback_direction", "critical", "Kaya may have reversed who will call", last+" → "+m.content, "Share our details; promise a callback only after an explicit team-call request.");
  }
  const lastUser=users[users.length-1]?.content??"";
  const declined=/\b(not ready|no need to book|no thanks|i'?ll let you know)\b/i.test(lastUser);
  const handover=/\b(team|someone)\b.{0,45}\b(call you|contact you|be in touch|get back)/i.test(assistants[assistants.length-1]?.content??"");
  const outcome = findings.some(f=>f.code==="unsaved_booking" || f.code==="sunday_booking") ? "questionable_booking" : hasSlot && booking ? "booking_needs_verification" : declined ? "not_ready" : handover ? "team_handover_needs_verification" : findings.length ? "needs_review" : "no_booking";
  return { outcome, findings, booking_verified: false, verification_note: hasSlot ? "Recorded booking; consent and live Bigin event still need verification. Attendance is separate." : "No confirmed booking verified." };
}
export const FIXTURES: { name: string; chat: Chat; codes: string[] }[] = [
  {name:"Customer name Ali is retained",chat:{phone:"test",name:"Ali",messages:[]},codes:[]},
  {name:"Call cannot be a name",chat:{phone:"test",name:"Call",messages:[]},codes:["invalid_name"]},
  {name:"Customer-initiated call is not a callback",chat:{phone:"test",messages:[{role:"user",content:"im call you"},{role:"assistant",content:"Our team will call you tomorrow."}]},codes:["callback_direction"]},
  {name:"Correct customer-initiated call",chat:{phone:"test",messages:[{role:"user",content:"I'll call you"},{role:"assistant",content:"You can call us on 058 582 5543."}]},codes:[]},
  {name:"False booking confirmation",chat:{phone:"test",messages:[{role:"assistant",content:"You're booked for Saturday."}]},codes:["unsaved_booking"]},
  {name:"Repeated question",chat:{phone:"test",messages:[{role:"assistant",content:"What time would you like to come?"},{role:"user",content:"3 PM"},{role:"assistant",content:"What time would you like to come?"}]},codes:["repeated_reply"]},
  {name:"Specs unknown must not be asked again",chat:{phone:"test",messages:[{role:"assistant",content:"Is it GCC specs, non-GCC, or are you unsure?"},{role:"user",content:"Unsure"},{role:"assistant",content:"Is it GCC specs?"}]},codes:["question_after_unknown","question_loop"]},
  {name:"Paraphrased repeated year question",chat:{phone:"test",messages:[{role:"assistant",content:"What year is the car?"},{role:"user",content:"Annasamy Sankar"},{role:"assistant",content:"Could you type the car's year?"}]},codes:["question_loop"]},
  {name:"Successful booking stays unflagged",chat:{phone:"test",name:"Ali",appointment_date:"2026-10-17",appointment_time:"15:00",bigin_pushed_at:"2026-10-15",messages:[{role:"user",content:"Book Saturday at 3 PM"},{role:"assistant",content:"You're booked for Saturday at 3 PM."}]},codes:[]},
];
export function regression() { return FIXTURES.map(f=>({name:f.name,passed:JSON.stringify(detect(f.chat).findings.map(x=>x.code).sort())===JSON.stringify([...f.codes].sort())})); }
