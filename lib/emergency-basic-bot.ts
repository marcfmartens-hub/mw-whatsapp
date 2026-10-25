import { type Conversation, updateConversation, getConversation } from "./supabase";
import { sendWhatsAppMessage } from "./meta";
import { extractVehicleInfo } from "./claude";
import { createBiginContact, moveLeadToCallBack, toIsoDate, toTime24 } from "./bigin";
import { slotValid, LOCATION } from "./conversation-state";

type Basic = { basicMode: "Emergency Basic Bot V1"; basicStep: "name"|"vehicle"|"timeline"|"choice"|"daytime"|"confirm"|"callback"|"done"; proposedDate?:string; proposedTime?:string; offscript?:boolean };
const GREETING = "Hi! 👋 Welcome to Mister Wheelz. I'm Kaya, your virtual car-selling assistant. I'll help you take the next step towards selling your car. May I have your name, please?";
const CHOICE = "I'm a virtual assistant 😊 I can book a free inspection or arrange a callback from our team. Which would you prefer?";
const CALLBACK = "No problem, I understand. I'll forward this to our team so they can help you personally.";
const FORBIDDEN = /\b(politics|political|president|election|government|religion|religious|islam|christian|christianity|muslim|hindu|staff|employee|salary|colleague|manager name|owner name|personal number|private details|internal information)\b/i;
const SELL_INTENT = /\b(sell|selling|car|vehicle|buyer|buy my|trade)\b/i;
const VEHICLE_INTENT = /\b(19\d{2}|20\d{2}|toyota|nissan|bmw|mercedes|audi|lexus|porsche|rover|volkswagen|honda|ford|kia|hyundai|mazda|mitsubishi)\b/i;
const OBJECT = /\b(price|how much|offer|valuation|home visit|come to me|pickup|pick up|can't come|cannot come|not interested|not ready|don't want|do not want|why|how does|explain|loan|mortgage|consignment|cash|human|person|manager|call me|callback|call back)\b/i;
const WANT_CALL = /\b(call\s*(me|back)|callback|call back|phone me|team|human|person|speak to|contact me)\b/i;
const WANT_BOOK = /\b(book|inspection|appointment|visit|bring|come)\b/i;
const REFUSE = /\b(no|not now|later|don't|do not|refuse|stop|never)\b/i;
const normalName = (s:string) => s.trim().replace(/^(my name is|i am|i'm|this is)\s+/i,"").replace(/[.!]+$/,"");
function nameFrom(s:string):string|null { const n=normalName(s); return /^[a-z][a-z '-]{1,45}$/i.test(n) && !/^(hi|hello|hey|call|yes|no|okay|ok|price|cash|consignment|today|tomorrow|book|inspection)$/i.test(n) && !OBJECT.test(n) ? n : null; }
async function crm(c:Conversation, status:string, booked=false) {
 try {
   const note="Emergency Basic Bot V1 — "+status+"\nSelling timeline: "+(c.sell_timeline||"unknown")+"\nRecent chat: "+(c.messages||[]).slice(-12).map(m=>m.role+": "+m.content).join("\n");
   const ok=await createBiginContact({...c,phone_number:c.phone_number||c.phone,inspection_booked:booked,inquiry_summary:note,sales_inquiry:booked?"Not Sure - Need Advise":"Other"} as any);
   if(ok) { if(status==="Callback requested") await moveLeadToCallBack(c.phone); await updateConversation(c.phone,{bigin_pushed_at:new Date().toISOString(),inquiry_summary:note}); }
   else console.error("[emergency-basic] Bigin did not confirm write",c.phone);
 } catch(e){console.error("[emergency-basic] Bigin write failed",e);}
}
export async function emergencyBasicTurn(c:Conversation,text:string) {
 const state=(c.flow_state||{}) as any;
 const b:Basic=state.basicMode==="Emergency Basic Bot V1" ? state as Basic : {basicMode:"Emergency Basic Bot V1",basicStep:c.name?"vehicle":"name"};
 const msg=text.trim();
 const updates:Record<string,any>={phone_number:c.phone_number||c.phone};
 let reply="";
 let status="Lead collecting";
 const objection=OBJECT.test(msg);
 const call=WANT_CALL.test(msg);
 const booking=WANT_BOOK.test(msg);
 const affirmative=/^(yes|yeah|yep|correct|sure|ok|okay|fine|that is right)$/i.test(msg);
 const no=REFUSE.test(msg);
 const extracted= /\b(19\d{2}|20\d{2})\b|\b(car|toyota|nissan|bmw|mercedes|audi|lexus|porsche|range rover|volkswagen|honda|ford)\b/i.test(msg)
   ? await extractVehicleInfo(msg,{make:c.make||undefined,model:c.model||undefined,year:c.year||undefined}).catch(()=>({})) : {};
 for(const k of ["make","model","year","mileage","specs"] as const) if((extracted as any)[k]) updates[k]=(extracted as any)[k];
 if(FORBIDDEN.test(msg)) { reply="I can only help with selling your car. I can book a free inspection or arrange a callback from our team. Which would you prefer?"; b.basicStep="choice"; }
 else if(!state.basicMode && !(c.messages||[]).some(m=>m.role==="assistant")) { b.basicStep="name"; reply=GREETING; }
 else if(b.basicStep==="callback") {
   // A callback is terminal: an acknowledgement can NEVER restart inspection booking.
   b.basicStep="done"; status="Callback requested";
   reply=CALLBACK+" Our team will contact you on this WhatsApp number.";
 } else if(call || (objection && b.basicStep!=="name" && b.basicStep!=="vehicle" && b.basicStep!=="timeline" && !booking)) {
   b.basicStep="callback"; reply=CALLBACK+" To help our team, please share the car make, model and year if you haven\'t already."; status="Callback requested";
 } else if(b.basicStep==="name") {
   const n=nameFrom(msg);
   if(n){updates.name=n; b.basicStep="vehicle"; reply="Nice to meet you! Which car are you selling? Please share the make, model and year.";}
   else if(SELL_INTENT.test(msg)) { b.basicStep="vehicle"; reply="Of course, I can help you sell your car 😊 Which make, model and year is it?"; }
   else if(objection) { b.basicStep="choice"; reply=CHOICE; }
   else { b.basicStep="vehicle"; reply="I can help you with that. Which car would you like to sell? Please share the make, model and year."; }
 } else if(b.basicStep==="vehicle") {
   const make=updates.make||c.make,model=updates.model||c.model,year=updates.year||c.year;
   if(make && model && year){ b.basicStep="timeline"; reply="Thank you! When are you planning to sell your car?"; }
   else if(objection){b.basicStep="choice";reply=CHOICE;}
   else reply="Thanks! Please share the car's make, model and year.";
 } else if(b.basicStep==="timeline") {
   if(objection && !/\b(today|tomorrow|this week|next week|month|asap|urgent|soon)\b/i.test(msg)){b.basicStep="choice";reply=CHOICE;}
   else {updates.sell_timeline=msg.slice(0,200); b.basicStep="choice"; reply="Thanks! We can arrange a free, no-obligation inspection at our location. Would you like to book an inspection, or prefer a callback from our team?";}
 } else if(b.basicStep==="choice") {
   if((booking||affirmative) && !no){b.basicStep="daytime";reply="Of course! Which day and time would you prefer to bring the car for inspection?";}
   else if(call||no||objection){b.basicStep="callback";reply=CALLBACK+" To help our team, please share the car make, model and year if you haven\'t already.";status="Callback requested";}
   else reply=CHOICE;
 } else if(b.basicStep==="daytime") {
   if(no||call||objection && !/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(msg)){b.basicStep="callback";reply=CALLBACK+" Is this WhatsApp number the best one for our team to call?";status="Callback requested";}
   else {
     const date=toIsoDate(msg)||b.proposedDate;
     const time=toTime24(msg)||b.proposedTime;
     if(date) b.proposedDate=date;
     if(time) b.proposedTime=time;
     if(!date)reply="Which day would suit you for the free inspection?";
     else if(!time)reply="What time would suit you on "+date+"?";
     else if(!slotValid(date,time))reply="Sorry, that time isn't available within our opening hours. Could you choose another day or time? We're closed on Sundays.";
     else if(!(updates.name||c.name)) { b.basicStep="confirm"; reply="I have "+[updates.make||c.make,updates.model||c.model,updates.year||c.year].filter(Boolean).join(" ")+" for "+date+" at "+time+". Before confirming, may I have your name for the booking?"; }
     else {b.basicStep="confirm";reply="Please confirm: "+(updates.name||c.name||"Customer")+", "+[updates.make||c.make,updates.model||c.model,updates.year||c.year].filter(Boolean).join(" ")+", inspection on "+date+" at "+time+". Your contact number is +"+c.phone.replace(/^\+/,"")+". Reply YES to confirm, or tell me what to change.";}
   }
 } else if(b.basicStep==="confirm") {
   if(!(updates.name||c.name) && nameFrom(msg)) {updates.name=nameFrom(msg);reply="Thank you! Please confirm your inspection for "+[updates.make||c.make,updates.model||c.model,updates.year||c.year].filter(Boolean).join(" ")+" on "+b.proposedDate+" at "+b.proposedTime+". Reply YES to confirm.";}
   else if(/^(yes|yes please|confirm|confirmed|correct|ok|okay|sure)$/i.test(msg)){
     if(!(updates.name||c.name)) {reply="Before I confirm, may I have your name for the booking?";}
     else if(!b.proposedDate||!b.proposedTime||!slotValid(b.proposedDate,b.proposedTime)){b.basicStep="daytime";reply="Please choose a valid inspection day and time.";}
     else {updates.appointment_date=b.proposedDate;updates.appointment_time=b.proposedTime;updates.appointment=b.proposedDate+" "+b.proposedTime;b.basicStep="done";status="Inspection booked";reply="Your free inspection is confirmed for "+b.proposedDate+" at "+b.proposedTime+".\n\n"+LOCATION+"\n\nPlease bring your Emirates ID and vehicle registration. See you soon!";}
   } else if(call||no||objection){b.basicStep="callback";reply=CALLBACK+" Is this WhatsApp number the best one for our team to call?";status="Callback requested";}
   else {b.basicStep="daytime";b.proposedDate=undefined;b.proposedTime=undefined;reply="No problem. Which day and time would you prefer instead?";}
 } else {reply="Thank you. Our team will follow up if you requested a callback."; }
 const fresh=await getConversation(c.phone).catch(()=>null);
 const messages=[...((fresh?.messages||c.messages||[]) as any[]),{role:"assistant",content:reply}].slice(-40);
 updates.flow_state={...state,...b,version:1,status:status==="Inspection booked"?"booked":status==="Callback requested"?"team_accepted":"collecting"};
 updates.step=status==="Inspection booked"?8:Math.max(c.step||0,1);
 updates.messages=messages;
 await updateConversation(c.phone,updates);
 await sendWhatsAppMessage(c.phone,reply);
 const saved=await getConversation(c.phone);
 if(saved) await crm(saved,status,status==="Inspection booked");
 return status;
}
