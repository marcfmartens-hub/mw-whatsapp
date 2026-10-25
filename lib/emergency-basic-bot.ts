import { type Conversation, updateConversation, getConversation } from "./supabase";
import { sendWhatsAppMessage } from "./meta";
import { extractVehicleInfo } from "./claude";
import { createBiginContact, moveLeadToCallBack } from "./bigin";
import { slotValid, LOCATION, dateFromText, timeFromText, supportedVehicle } from "./conversation-state";

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
type State = { basicMode:string; basicStep:string; proposedDate?:string; proposedTime?:string; offscript?:boolean; status?:string; askedVehicle?:string[]; scheduleClarified?:boolean };
const nameFrom = (text:string) => {
 const n=text.trim().replace(/^(my name is|i am|i'm|this is)\s+/i, "").replace(/[.!]+$/, "");
 return /^[a-z][a-z '-]{1,45}$/i.test(n) && !/\b(hi|hello|hey|call|yes|no|okay|ok|price|cash|today|tomorrow|book|inspection|why|what|how|want|selling|sell|please|thanks|thank|stop|later|team|human|location)\b/i.test(n) ? n : null;
};
export function planEmergencyTurn(c:any, text:string, fields:Record<string,any>={}, now=new Date()) {
 const old=c.flow_state||{};
 const b:State = /Emergency (Basic|Chat) Bot V1/.test(old.basicMode||"") ? {...old,basicMode:EMERGENCY_MODE} : {basicMode:EMERGENCY_MODE,basicStep:c.name?"vehicle":"name"};
 const u:Record<string,any>={};
 for(const k of ["make","model","year","mileage","specs"]) if(fields[k])u[k]=fields[k];
 // Read earlier customer answers as well as the current message. The extractor can
 // omit uncertainty; explicit specs and mileage answers must still be retained.
 const vehicleStage=["vehicle","contact","confirm"].includes(b.basicStep);
 const history=(c.messages||[]) as {role:string;content:string}[];
 // Migrate old chats using the last meaningful question, even if a later bad
 // reply restarted the questionnaire. Never discard their recorded facts.
 if(!old.basicMode){
   const assistants=history.filter(m=>m.role==="assistant");
   const scheduling=[...assistants].reverse().find(m=>/what time|which day.*inspection|when.*bring/i.test(m.content));
   const timeline=assistants.some(m=>/when.*planning to sell/i.test(m.content));
   if(old.status==="booked")b.basicStep="done";
   else if(old.proposedDate||scheduling){b.basicStep="daytime";b.proposedDate=old.proposedDate||dateFromText(scheduling?.content||"",now);b.proposedTime=old.proposedTime;}
   else if(timeline)b.basicStep="timeline";
 }
 let recovered:any={make:c.make,model:c.model,year:c.year};
 let previousQuestion="";
 for(const entry of [...history,{role:"user",content:text}]){
   if(entry.role==="assistant"){previousQuestion=entry.content;continue;}
   recovered=supportedVehicle(entry.content,recovered,{},/mileage/i.test(previousQuestion)?"mileage":"");
   // A short year after a year question is a year, never an odometer reading.
   if(/year/i.test(previousQuestion)&&/^\s*(?:19|20)?\d{2}\s*$/.test(entry.content)){
     const n=Number(entry.content.trim());if(n>=90&&n<=99)recovered.year=String(1900+n);
     else if(n>=0&&n<=new Date(now).getUTCFullYear()%100+1)recovered.year=String(2000+n);
   }
 }
 for(const k of ["make","model","year"])if(recovered[k])u[k]=recovered[k];
 const userTexts=[...history.filter(m=>m.role==="user").map(m=>m.content),text];
 for(const answer of userTexts){
   if(/\b(non[ -]?gcc|not gcc|american specs|european specs|japanese specs|korean specs|chinese specs)\b/i.test(answer))u.specs="Non-GCC";
   else if(/\bgcc\b/i.test(answer)&&!/\b(not sure|unsure|unknown|don'?t know|do not know|gcc or)\b/i.test(answer))u.specs="GCC";
   else if(/\b(not sure|unsure|unknown|don'?t know|do not know)\b/i.test(answer) && (vehicleStage||/\b(specs|specifications|gcc|bmw|toyota|mercedes|audi|nissan|lexus|porsche|ford|honda)\b/i.test(answer)))u.specs="Unknown";
   const mileage=answer.match(/\b(\d[\d,]*(?:\.\d+)?)\s*(k)?\s*(?:km|kms|kilomet(?:er|re)s?)\b/i)
     || (vehicleStage?answer.trim().match(/^(\d[\d,]*(?:\.\d+)?)\s*(k)$/i):null);
   if(mileage)u.mileage=String(Math.round(Number(mileage[1].replace(/,/g,""))*(mileage[2]?1000:1)));
 }
 // An explicit field extracted from this message takes precedence over older history,
 // except that an uncertain specs answer must never be overwritten by a guess.
 for(const k of ["make","model","year","mileage","specs"])if(fields[k]&&!u[k])u[k]=fields[k];
 if(vehicleStage&&/\b(not sure|unsure|unknown|don'?t know|do not know)\b/i.test(text))u.specs="Unknown";
 const value=(k:string)=>u[k]||c[k];
 const phone=()=>value("phone_number") || (/^\+?\d{9,15}$/.test(c.phone||"")?c.phone:null);
 const msg=text.trim();
 const sellerIntent=/\b(sell|selling|car|vehicle)\b/i.test(msg) || !!supportedVehicle(msg,{},{}).make;
 const call=/\b(call\s*(me|back)|callback|phone me|human|speak to|contact me|team)\b/i.test(msg);
 const book=/\b(book|inspection|appointment|visit|bring|come)\b/i.test(msg);
 const refuse=/\b(no|not now|not interested|not ready|can't|cannot|don't(?! know)|do not(?! know)|refuse|stop|never)\b/i.test(msg);
 const objection=/\?|\b(price|how much|offer|valuation|home visit|pickup|pick up|why|how does|explain|loan|mortgage|consignment|cash|politic|religion|location|address)\b/i.test(msg);
 const yes=/^(yes|yes please|yeah|yep|confirm|confirmed|correct|sure|ok|okay|fine)[.!]?$/i.test(msg);
 const date=dateFromText(msg,now), time=timeFromText(msg,true);
 if(b.basicStep==="vehicle" && /mileage/i.test(history.filter(m=>m.role==="assistant").at(-1)?.content||"") && /^\d[\d,]*$/.test(msg))u.mileage=msg.replace(/,/g,"");
 let reply="", action="collecting";
 const vehicleKeys=["make","model","year","mileage","specs"];
 const questions:Record<string,string>={make:"What make is the car?",model:"Which model is it?",year:"What year is it?",mileage:"What is the mileage?",specs:"Is it GCC or non-GCC?"};
 b.askedVehicle=[...(b.askedVehicle||[])];
 // Restore asked fields for chats started before per-field tracking was added.
 const lastAssistant=history.filter(m=>m.role==="assistant").at(-1)?.content||"";
 for(const k of vehicleKeys)if((lastAssistant===questions[k] || k==="specs"&&/Please share your car's GCC/i.test(lastAssistant))&&!b.askedVehicle.includes(k))b.askedVehicle.push(k);
 const nextVehicle=()=>{
   const k=vehicleKeys.find(k=>!value(k)&&!b.askedVehicle!.includes(k));
   if(k){b.askedVehicle!.push(k);b.basicStep="vehicle";reply=questions[k];}
   else {b.basicStep="timeline";reply="When are you planning to sell the car?";}
 };
 const continueSeller=()=>{
   b.basicStep="vehicle";b.offscript=false;
   if(value("make")&&!value("model")&&!value("year")&&!b.askedVehicle!.includes("model")&&!b.askedVehicle!.includes("year")){
     b.askedVehicle!.push("model","year");reply="Which model and year is the car?";
   }else if(!value("make")&&!b.askedVehicle!.includes("make")){
     b.askedVehicle!.push("make");reply="Which car are you planning to sell?";
   }else nextVehicle();
   reply="No problem, we can help you with that. "+reply;
 };
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
 else if(sellerIntent && ["name","choice"].includes(b.basicStep))continueSeller();
 else if(!(c.messages||[]).some((m:any)=>m.role==="assistant") && !old.basicMode){reply="Hi, I'm Kaya, Mister Wheelz's virtual assistant. What’s your name?";b.basicStep="name";}
 else if(objection && !date && !time && !book && !(vehicleStage && /\b(not sure|unsure|unknown|don'?t know|do not know)\b/i.test(msg))){if(b.offscript)callback();else{b.offscript=true;b.basicStep="choice";reply=CHOICE;}}
 else if(b.basicStep==="name"){
   const n=nameFrom(msg);
   if(n){u.name=n;b.basicStep="vehicle";reply="Which car are you planning to sell?";}
   else {b.offscript=true;b.basicStep="choice";reply=CHOICE;}
 }
 else if(b.basicStep==="vehicle"){
   if(book){b.basicStep="daytime";reply=SCHEDULE_QUESTION;}
   else if(/\b(today|tomorrow|week|month|asap|urgent|soon|now)\b/i.test(msg)&&!/\b(km|kms)\b/i.test(msg)){
     u.sell_timeline=msg.slice(0,200);b.basicStep="daytime";reply=SCHEDULE_QUESTION;
   }else nextVehicle();
 }
 else if(b.basicStep==="timeline"){
   if(book||/\b(today|tomorrow|week|month|year|asap|urgent|soon|now|immediately|ready|day|sell|selling)\b/i.test(msg)){
     if(!book)u.sell_timeline=msg.slice(0,200);
     b.basicStep="daytime";reply=SCHEDULE_QUESTION;
   }else callback();
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
   const immediate=/^(now|immediately|asap)[.!]?$/i.test(msg);
   if(!immediate){if(date)b.proposedDate=date;if(time)b.proposedTime=time;}
   if(immediate){
     const local=new Date(+now+4*3600e3),today=local.toISOString().slice(0,10);
     const minutes=local.getUTCHours()*60+local.getUTCMinutes();
     const open=local.getUTCDay()!==0&&minutes>=(local.getUTCDay()===5?720:600)&&minutes<1110;
     let target=today;
     if(!open){let next=new Date(+local+86400e3);while(next.getUTCDay()===0)next=new Date(+next+86400e3);target=next.toISOString().slice(0,10);}
     const tomorrow=new Date(+local+86400e3).toISOString().slice(0,10);
     const label=target===today?"today":target===tomorrow?"tomorrow":inspectionDay(target);
     b.proposedDate=target;b.proposedTime=undefined;
     const question="What time can you come "+label+"?";
     if(history.some(m=>m.role==="assistant"&&m.content.includes(question))){
       callback();
     }else reply=(open?"":"We're closed now. ")+question;
   }
   else if(!date&&!time){callback();}
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
 if(reply.includes("?")&&history.some(m=>m.role==="assistant"&&m.content.trim()===reply.trim()))callback();
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
