import { type Conversation, updateConversation, getConversation } from "./supabase";
import { sendWhatsAppMessage } from "./meta";
import { extractVehicleInfo } from "./claude";
import { createBiginContact, moveLeadToCallBack } from "./bigin";
import { slotValid, LOCATION, dateFromText, timeFromText } from "./conversation-state";

export const EMERGENCY_MODE = "Emergency Chat Bot V1";
const SCHEDULE_QUESTION = "Which day and time do you want for the inspection?";
export function inspectionDay(date:string):string {
 const d=new Date(date+"T12:00:00Z"), n=d.getUTCDate();
 const suffix=n%100>=11&&n%100<=13?"th":({1:"st",2:"nd",3:"rd"} as Record<number,string>)[n%10]||"th";
 return d.toLocaleDateString("en-GB",{weekday:"long",timeZone:"UTC"})+" "+n+suffix+" of "+d.toLocaleDateString("en-GB",{month:"long",timeZone:"UTC"});
}
export function inspectionTime(time:string):string {
 const [h,m]=time.split(":").map(Number);
 return (h%12||12)+(m?":"+String(m).padStart(2,"0"):"")+" "+(h>=12?"pm":"am");
}
// Keep location and contact information without appending the old opening-hours line.
const BOOKING_LOCATION = LOCATION.split("\n").filter(line=>!/^Mon[–-]Sat/.test(line)).join("\n");
const CHOICE = "I understand. I'm a virtual assistant. I can book a free inspection or arrange a callback from the team. Which would you prefer?";
type State = { basicMode:string; basicStep:string; proposedDate?:string; proposedTime?:string; offscript?:boolean; status?:string };
const nameFrom = (text:string) => {
 const n=text.trim().replace(/^(my name is|i am|i'm|this is)\s+/i, "").replace(/[.!]+$/, "");
 return /^[a-z][a-z '-]{1,45}$/i.test(n) && !/\b(hi|hello|hey|call|yes|no|okay|ok|price|cash|today|tomorrow|book|inspection|why|what|how|want|selling|sell|please|thanks|thank|stop|later|team|human|location)\b/i.test(n) ? n : null;
};
export function planEmergencyTurn(c:any, text:string, fields:Record<string,any>={}, now=new Date()) {
 const old=c.flow_state||{};
 const b:State = /Emergency (Basic|Chat) Bot V1/.test(old.basicMode||"") ? {...old,basicMode:EMERGENCY_MODE} : {basicMode:EMERGENCY_MODE,basicStep:c.name?"vehicle":"name"};
 const u:Record<string,any>={};
 for(const k of ["make","model","year","mileage","specs"]) if(fields[k])u[k]=fields[k];
 const value=(k:string)=>u[k]||c[k];
 const phone=()=>value("phone_number") || (/^\+?\d{9,15}$/.test(c.phone||"")?c.phone:null);
 const msg=text.trim();
 const call=/\b(call\s*(me|back)|callback|phone me|human|speak to|contact me|team)\b/i.test(msg);
 const book=/\b(book|inspection|appointment|visit|bring|come)\b/i.test(msg);
 const refuse=/\b(no|not now|not interested|not ready|can't|cannot|don't|do not|refuse|stop|never)\b/i.test(msg);
 const objection=/\?|\b(price|how much|offer|valuation|home visit|pickup|pick up|why|how does|explain|loan|mortgage|consignment|cash|politic|religion|location|address)\b/i.test(msg);
 const yes=/^(yes|yes please|yeah|yep|confirm|confirmed|correct|sure|ok|okay|fine)[.!]?$/i.test(msg);
 const date=dateFromText(msg,now), time=timeFromText(msg,true);
 let reply="", action="collecting";
 const missingVehicle=()=>["make","model","year","mileage","specs"].filter(k=>!value(k));
 const labels:Record<string,string>={make:"make",model:"model",year:"year",mileage:"mileage",specs:"GCC specifications or whether you're unsure"};
 const askVehicle=()=>"Please share your car's "+missingVehicle().map(k=>labels[k]).join(", ")+".";
 const callback=()=>{
   b.basicStep="callback";
   const missing=[!value("name")?"name":null,!phone()?"phone number":null].filter(Boolean);
   if(missing.length) reply="No problem. I'll forward your request to the team so they can help you as best as possible. Please provide your "+missing.join(" and ")+".";
   else {b.basicStep="done";action="callback";reply="Thank you, "+value("name")+". I've recorded your callback request for the team.";}
 };
 const contact=()=>{
   if(!b.proposedDate||!b.proposedTime||!slotValid(b.proposedDate,b.proposedTime,now)){
     b.basicStep="daytime";b.proposedDate=undefined;b.proposedTime=undefined;
     reply="That time isn't available. "+SCHEDULE_QUESTION;
   }
   else if(!value("name"))reply="May I have your name for the booking?";
   else if(!phone())reply="What phone number should we use for your booking?";
   else if(missingVehicle().length)reply=askVehicle();
   else {
     u.appointment_date=b.proposedDate;u.appointment_time=b.proposedTime;
     u.appointment=b.proposedDate+" "+b.proposedTime;b.basicStep="done";action="booked";
     reply="Your free inspection is confirmed for "+inspectionDay(b.proposedDate)+" at "+inspectionTime(b.proposedTime)+".\n\n"+BOOKING_LOCATION;
   }
 };
 // Terminal acknowledgements must never restart booking or create another callback.
 if(b.basicStep==="done") {reply="Thank you.";}
 else if(b.basicStep==="callback") {
   if(!value("name")){const n=nameFrom(msg.replace(/\+?\d[\d ()-]{7,18}\d/g, "").trim());if(n)u.name=n;}
   const number=msg.match(/\+?\d[\d ()-]{7,18}\d/);if(number)u.phone_number=number[0].replace(/[^\d+]/g,"");
   callback();
 }
 else if(call || refuse)callback();
 else if(!(c.messages||[]).some((m:any)=>m.role==="assistant") && !old.basicMode){reply="Hi, I'm Kaya, Mister Wheelz's virtual assistant. What’s your name?";b.basicStep="name";}
 else if(objection && !date && !time && !book){if(b.offscript)callback();else{b.offscript=true;b.basicStep="choice";reply=CHOICE;}}
 else if(b.basicStep==="name"){
   const n=nameFrom(msg);
   if(n){u.name=n;b.basicStep="vehicle";reply=missingVehicle().length?askVehicle():"When are you planning to sell your car?";if(!missingVehicle().length)b.basicStep="timeline";}
   else {b.offscript=true;b.basicStep="choice";reply=CHOICE;}
 }
 else if(b.basicStep==="vehicle"){
   if(!missingVehicle().length){b.basicStep="timeline";reply="When are you planning to sell your car?";}
   else if(Object.keys(u).length)reply=askVehicle();
   else if(b.offscript)callback();else{b.offscript=true;b.basicStep="choice";reply=CHOICE;}
 }
 else if(b.basicStep==="timeline"){
   if(/\b(today|tomorrow|week|month|year|asap|urgent|soon|now|ready|day|sell|selling)\b/i.test(msg)){u.sell_timeline=msg.slice(0,200);b.basicStep="choice";reply="Would you prefer to book a free inspection or have our team call you?";}
   else if(b.offscript)callback();else{b.offscript=true;b.basicStep="choice";reply=CHOICE;}
 }
 else if(b.basicStep==="choice"){
   if(book||yes||date||time){
     b.basicStep="daytime";if(date)b.proposedDate=date;if(time)b.proposedTime=time;
     if(b.proposedDate&&b.proposedTime&&slotValid(b.proposedDate,b.proposedTime,now)){b.basicStep="contact";contact();}
     else if(b.proposedDate&&!b.proposedTime)reply="What time do you want for the inspection?";
     else if(b.proposedTime&&!b.proposedDate)reply="Which day do you want for the inspection?";
     else reply=SCHEDULE_QUESTION;
   }
   else if(b.offscript)callback();else{b.offscript=true;reply=CHOICE;}
 }
 else if(b.basicStep==="daytime"){
   if(date)b.proposedDate=date;if(time)b.proposedTime=time;
   if(!date&&!time){if(b.offscript)callback();else{b.offscript=true;reply=CHOICE;}}
   else if(!b.proposedDate)reply="Which day do you want for the inspection?";
   else if(!b.proposedTime)reply="What time do you want for the inspection?";
   else if(!slotValid(b.proposedDate,b.proposedTime,now)){b.proposedDate=undefined;b.proposedTime=undefined;reply="That time isn't available. "+SCHEDULE_QUESTION;}
   else {b.basicStep="contact";contact();}
 }
 else if(b.basicStep==="contact"){
   if(!value("name")){const n=nameFrom(msg.replace(/\+?\d[\d ()-]{7,18}\d/g, "").trim());if(n)u.name=n;}
   else if(!phone()){const n=msg.replace(/[^\d+]/g,"");if(/^\+?\d{9,15}$/.test(n))u.phone_number=n;}
   contact();
 }
 else if(b.basicStep==="confirm"){
   // Existing chats awaiting YES move directly into the new missing-data check.
   if(date)b.proposedDate=date;if(time)b.proposedTime=time;
   b.basicStep="contact";contact();
 }
 else {b.basicStep="choice";reply=CHOICE;}
 b.status=b.basicStep==="done" && action==="collecting" ? (old.status||"collecting") : action==="booked"?"booked":action==="callback"?"team_accepted":"collecting";
 u.flow_state={...old,...b,version:1};
 return {reply,updates:u,action,state:b};
}
export async function emergencyBasicTurn(c:Conversation,text:string) {
 const fields=await extractVehicleInfo(text,{make:c.make||undefined,model:c.model||undefined,year:c.year||undefined}).catch(()=>({}));
 const turn=planEmergencyTurn(c,text,fields);
 const fresh=await getConversation(c.phone);
 const messages=[...(fresh?.messages||c.messages||[]),{role:"assistant" as const,content:turn.reply}].slice(-40);
 // Record the request before telling the customer it is confirmed.
 await updateConversation(c.phone,{...turn.updates,messages,step:turn.action==="booked"?8:Math.max(c.step||0,1)});
 await sendWhatsAppMessage(c.phone,turn.reply);
 const saved=await getConversation(c.phone);
 if(saved && turn.action!=="collecting") {
   const note=EMERGENCY_MODE+" — "+turn.action+"\nSelling timeline: "+(saved.sell_timeline||"unknown");
   const ok=await createBiginContact({...saved,phone_number:saved.phone_number||saved.phone,inspection_booked:turn.action==="booked",inquiry_summary:note,sales_inquiry:turn.action==="booked"?"Not Sure - Need Advise":"Other"} as any);
   if(ok){if(turn.action==="callback")await moveLeadToCallBack(c.phone);await updateConversation(c.phone,{bigin_pushed_at:new Date().toISOString(),inquiry_summary:note});}
   else console.error("[emergency] Bigin write not confirmed",c.phone);
 }
 return turn.action;
}
