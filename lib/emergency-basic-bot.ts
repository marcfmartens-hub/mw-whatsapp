import { type Conversation, updateConversation, getConversation } from "./supabase";
import { sendWhatsAppMessage } from "./meta";
import { extractVehicleInfo } from "./claude";
import { createBiginContact, moveLeadToCallBack } from "./bigin";
import { CAR_MAKES, CAR_MODELS } from "./carData";
import { slotValid, LOCATION, dateFromText, timeFromText, supportedVehicle } from "./conversation-state";

export const EMERGENCY_MODE = "Emergency Chat Bot V1";
const FUTURE_QUESTION = "Would you like to book a free inspection this week or next month?";
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
type State = { basicMode:string; basicStep:string; proposedDate?:string; proposedTime?:string; offscript?:boolean; status?:string; askedVehicle?:string[]; scheduleClarified?:boolean; sentReplies?:string[]; callbackAsked?:string[]; inspectionWindow?:string; resumeStep?:string; askingPriceAed?:string };
const nameFrom = (text:string) => {
 const n=text.trim().replace(/^(my name is|i am|i'm|this is)\s+/i, "").replace(/[.!]+$/, "");
 return /^[a-z][a-z '-]{1,45}$/i.test(n) && !/\b(hi|hello|hey|call|yes|no|okay|ok|price|cash|today|tomorrow|now|asap|immediately|book|inspection|why|what|how|want|selling|sell|please|thanks|thank|stop|later|team|human|location)\b/i.test(n) ? n : null;
};
// Match brand spellings deterministically before the optional AI extractor.
// Customers commonly write Mercedes, VW, Skoda or LandRover rather than canonical labels.
export function emergencyVehicle(text:string,known:any={},question=""){
 let normalized=text;
 const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
 for(const [alias,canonical]of Object.entries(CAR_MAKES)){
   if(alias.toLowerCase()===canonical.toLowerCase()||new RegExp("(?<![a-z0-9])"+escape(canonical)+"(?![a-z0-9])","i").test(normalized))continue;
   normalized=normalized.replace(new RegExp("\\b"+escape(alias)+"\\b","gi"),canonical);
 }
 normalized=normalized.replace(/\bvw\b/gi,"Volkswagen");
 const result=supportedVehicle(normalized,known,{},question);
 const brandOnly=Object.values(CAR_MAKES).find(make=>make.toLowerCase()===normalized.trim().toLowerCase());
 if(brandOnly&&!known.make)result.make=brandOnly;
 if(!result.make&&/\bseat\b/i.test(normalized)&&/\b(sell|selling)\b/i.test(normalized))result.make="SEAT";
 const modelKey=Object.keys(CAR_MODELS).find(make=>(CAR_MAKES[make]||make)===result.make);
 if(modelKey&&!known.model){
   const model=[...CAR_MODELS[modelKey]].sort((a,b)=>b.length-a.length).find(model=>new RegExp("(?<![a-z0-9])"+escape(model)+"(?![a-z0-9])","i").test(normalized));
   if(model)result.model=model;
 }
 if(result.make==="Mercedes-Benz"){
   const code=normalized.match(/\b(?:CLA|CLS|GLA|GLB|GLC|GLE|GLS|[ABCEGS])\s?\d{2,3}\b/i)?.[0];
   if(code&&!known.model)result.model=code.replace(/\s/g,"").toUpperCase();
 }
 return result;
}
export function emergencyInput(text:string){
 const kinds:string[]=[];
 if(/\[(?:photo|image)\]/i.test(text))kinds.push("pictures");
 if(/\[(?:file|document|video)\]/i.test(text))kinds.push("files");
 if(/\[(?:audio|voice|voice note)\]/i.test(text))kinds.push("voice notes");
 if(/https?:\/\/|www\./i.test(text))kinds.push("links");
 const clean=text.replace(/\[(?:photo|image|file|document|video|audio|voice|voice note)\]/gi," ").replace(/(?:https?:\/\/|www\.)\S+/gi," ").trim();
 return {kinds,text:clean};
}
export function planEmergencyTurn(c:any, text:string, fields:Record<string,any>={}, now=new Date()) {
 const media=emergencyInput(text);
 text=media.text;
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
   recovered=emergencyVehicle(entry.content,recovered,/mileage/i.test(previousQuestion)?"mileage":"");
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
   else if(/\bgcc\b/i.test(answer)&&!/\b(not sure|unsure|unknown|don'?t know|dont know|do not know|no idea|not certain|gcc or)\b/i.test(answer))u.specs="GCC";
   else if(/\b(not sure|unsure|unknown|don'?t know|dont know|do not know|no idea|not certain)\b/i.test(answer) && (vehicleStage||/\b(specs|specifications|gcc|bmw|toyota|mercedes|audi|nissan|lexus|porsche|ford|honda)\b/i.test(answer)))u.specs="Unknown";
   const mileage=answer.match(/\b(\d[\d,]*(?:\.\d+)?)\s*(k)?\s*(?:km|kms|kilomet(?:er|re)s?)\b/i)
     || (vehicleStage?answer.trim().match(/^(\d[\d,]*(?:\.\d+)?)\s*(k)$/i):null);
   if(mileage)u.mileage=String(Math.round(Number(mileage[1].replace(/,/g,""))*(mileage[2]?1000:1)));
 }
 // An explicit field extracted from this message takes precedence over older history,
 // except that an uncertain specs answer must never be overwritten by a guess.
 for(const k of ["make","model","year","mileage","specs"])if(fields[k]&&!u[k])u[k]=fields[k];
 if(vehicleStage&&/\b(not sure|unsure|unknown|don'?t know|dont know|do not know|no idea|not certain)\b/i.test(text))u.specs="Unknown";
 const value=(k:string)=>u[k]||c[k];
 const phone=()=>value("phone_number") || (/^\+?\d{9,15}$/.test(c.phone||"")?c.phone:null);
 const msg=text.trim().replace(/[’‘]/g,"'");
 const uncertain=/\b(not sure|unsure|unknown|don'?t know|dont know|do not know|no idea|not certain)\b/i.test(msg);
 const immediate=/\b(now|immediately|asap|right away|straight away)\b/i.test(msg)&&!/(?:not|can't|cannot)\s+(?:come\s+)?now/i.test(msg)&&!timeFromText(msg,true);
 if(uncertain&&vehicleStage)u.specs="Unknown";
 const greeting=/^(?:(?:hi+|hello+|hey+)(?: there| kaya)?|hiya|howdy|salaam|salam|good\s+(?:morning|afternoon|evening|day))[\s!.,👋😊]*$/i.test(msg);
 const sellingTime=msg.match(/\b(next month|this month|next week|this week|end of (?:the |this )?month|in (?:\d+|a|one|two|three|four) (?:days?|weeks?|months?)|today|tomorrow|asap|urgent|soon|now|immediately)\b/i)?.[0];
 if(sellingTime&&(["name","vehicle","timeline"].includes(b.basicStep)||/\b(sell|selling)\b/i.test(msg)))u.sell_timeline=sellingTime;
 const sellerIntent=/\b(sell|selling|car|vehicle)\b/i.test(msg) || !!emergencyVehicle(msg).make;
 const priceMatch=msg.match(/\b(?:asking(?: price)?|selling price|my price(?: is)?|looking for|want)\s*(?:is\s*)?(?:aed|dhs?|dirhams?)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?\b/i);
 const priceQuestion=/\?|\b(how much|what.*(?:price|offer)|can you|will you|would you|worth|valuation|estimate|your offer|you pay|you give)\b/i.test(msg);
 const statedPrice=!!priceMatch&&!priceQuestion;
 if(priceMatch)b.askingPriceAed=String(Math.round(Number(priceMatch[1].replace(/,/g,""))*(priceMatch[2]?1000:1)));
 const call=/\b(call\s*(me|back)|callback|phone me|human|speak to|contact me|team)\b/i.test(msg);
 const book=/\b(book(?:ing)?|inspection|appointment|visit|bring|come)\b/i.test(msg);
 const refuse=/\b(no|not now|not interested|not ready|can't|cannot|don't(?! know)|do not(?! know)|refuse|stop|never)\b/i.test(msg);
 const inquiry=/\b(price|how much|offer|valuation|home (?:visit|service|inspection)|come to (?:me|my|our)|pick[ -]?up|why|how does|explain|loan|mortgage|consignment|cash|politic|religion|location|address)\b/i;
 const objection=/\?|\b(price|how much|offer|valuation|home visit|pickup|pick up|why|how does|explain|loan|mortgage|consignment|cash|politic|religion|location|address)\b/i.test(msg);
 const yes=/^(yes|yes please|yeah|yep|confirm|confirmed|correct|sure|ok|okay|fine)[.!]?$/i.test(msg);
 let date=dateFromText(msg,now);
 const time=timeFromText(msg,true);
 const monthNames=["january","february","march","april","may","june","july","august","september","october","november","december"];
 const explicit=msg.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(20\d{2}))?\b/i);
 const localDate=new Date(+now+4*3600e3);
 if(explicit){
   let year=explicit[3]?Number(explicit[3]):localDate.getUTCFullYear();
   const month=monthNames.indexOf(explicit[2].toLowerCase());
   if(!explicit[3]&&month<localDate.getUTCMonth())year++;
   const d=new Date(Date.UTC(year,month,Number(explicit[1]),12));
   if(d.getUTCMonth()===month&&d.getUTCDate()===Number(explicit[1]))date=d.toISOString().slice(0,10);
 }
 else if(b.inspectionWindow==="next_month"){
   const day=msg.match(/\b(\d{1,2})(?:st|nd|rd|th)\b|\bon (\d{1,2})\b/i);
   if(day){const target=new Date(Date.UTC(localDate.getUTCFullYear(),localDate.getUTCMonth()+1,1,12)),month=target.getUTCMonth();target.setUTCDate(Number(day[1]||day[2]));if(target.getUTCMonth()===month)date=target.toISOString().slice(0,10);}
 }
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
   else if(/next month/i.test(value("sell_timeline")||"")){b.basicStep="inspection_window";reply=FUTURE_QUESTION;}
   else if(value("sell_timeline")){b.basicStep="daytime";reply=SCHEDULE_QUESTION;}
   else {b.basicStep="timeline";reply="When are you planning to sell the car?";}
 };
 const continueSeller=()=>{
   b.basicStep="vehicle";b.offscript=false;
   if(value("make")&&!value("model")&&!value("year")&&!b.askedVehicle!.includes("model")&&!b.askedVehicle!.includes("year")){
     b.askedVehicle!.push("model","year");reply="Which model and year is the car?";
   }else if(!value("make")&&!b.askedVehicle!.includes("make")){
     b.askedVehicle!.push("make");reply="Which car are you planning to sell?";
   }else nextVehicle();
   reply=(/\b(sell|selling)\b/i.test(msg)?"No problem, we can help you with that. ":"Ok, nice. ")+reply;
 };
 const callback=()=>{
   b.basicStep="callback";
   const missing=[!value("name")?"name":null,!phone()?"phone number":null].filter(Boolean);
   const asked=new Set(b.callbackAsked||[]);
   for(const m of history.filter(m=>m.role==="assistant")){
     if(/Please provide your name/i.test(m.content))asked.add("name");
     if(/Please provide your (?:name and )?phone number/i.test(m.content))asked.add("phone number");
   }
   const unasked=missing.filter(k=>!asked.has(String(k)));
   if(unasked.length){
     b.callbackAsked=[...asked,...unasked.map(String)];
     reply="No problem. I'll forward your request to the team so they can help you as best as possible. Please provide your "+unasked.join(" and ")+".";
   }else {
     b.basicStep="done";action="callback";
     reply=missing.length?"Understood. I'll pass the details you've shared to the team.":"Thank you, "+value("name")+". I've recorded your callback request for the team.";
   }
 };
 const objectionChoice=()=>{
   if(b.offscript||b.basicStep==="objection_choice")callback();
   else {
     b.resumeStep=b.basicStep;b.basicStep="objection_choice";b.offscript=true;
     reply=["daytime","contact","confirm","inspection_window"].includes(b.resumeStep)
       ?"I understand. I'm a virtual assistant. I can continue booking your free inspection or arrange a callback from the team. Would you like to continue booking or prefer a callback?"
       :CHOICE;
   }
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
 const arrangeSoon=()=>{
   b.basicStep="daytime";
   const local=new Date(+now+4*3600e3),today=local.toISOString().slice(0,10);
   const minutes=local.getUTCHours()*60+local.getUTCMinutes();
   const open=local.getUTCDay()!==0&&minutes>=(local.getUTCDay()===5?720:600)&&minutes<1110;
   let target=today;
   if(!open){let next=new Date(+local+86400e3);while(next.getUTCDay()===0)next=new Date(+next+86400e3);target=next.toISOString().slice(0,10);}
   const tomorrow=new Date(+local+86400e3).toISOString().slice(0,10);
   const label=target===today?"today":target===tomorrow?"tomorrow":inspectionDay(target);
   const opens=new Date(target+"T12:00:00Z").getUTCDay()===5?"12 pm":"10 am";
   b.proposedDate=target;b.proposedTime=undefined;
   const question="What time can you come "+label+"?";
   if(history.some(m=>m.role==="assistant"&&m.content.includes(question)))callback();
   else reply=(open?"":"We're closed now, but we open again "+label+" at "+opens+". ")+question;
 };
 // Terminal acknowledgements must never restart booking or create another callback.
 if(media.kinds.length&&!msg){
   // Attachments never answer a pending field and never advance the flow.
   const lastField=[...(b.askedVehicle||[])].reverse().find(k=>!value(k));
   const pending:Record<string,string>={make:"Please type the car make.",model:"Please type the model.",year:"Please type the year.",mileage:"Please type the mileage.",specs:"Please type GCC, non-GCC, or not sure."};
   if(b.basicStep==="done")reply="";
   else if(b.basicStep==="name"){b.basicStep="vehicle";reply="Please type which car you are planning to sell.";}
   else if(b.basicStep==="vehicle")reply=lastField?pending[lastField]:"Please type which car you are planning to sell.";
   else if(b.basicStep==="timeline")reply="Please type when you are planning to sell the car.";
   else if(b.basicStep==="daytime")reply=b.proposedDate?"Please type the time you can come for the inspection.":"Please type your preferred inspection day and time.";
   else if(b.basicStep==="contact"||b.basicStep==="confirm")reply=!value("name")?"Please type your name for the booking.":"Please type your contact phone number.";
   else if(b.basicStep==="callback")reply=!value("name")?"Please type your name for the team.":"Please type your contact phone number.";
   else if(b.basicStep==="inspection_window")reply="Please type this week or next month for the inspection.";
   else reply="Please type inspection or callback.";
 }
 else if(greeting&&b.basicStep==="name"){
   const hour=new Date(+now+4*3600e3).getUTCHours();
   const salutation=hour<12?"Good morning":hour<17?"Good afternoon":"Good evening";
   b.basicStep="vehicle";reply=salutation+". Which car are you planning to sell?";
 }
 else if(b.basicStep==="done") {reply="Thank you.";}
 else if(b.basicStep==="callback") {
   if(!value("name")){const n=nameFrom(msg.replace(/\+?\d[\d ()-]{7,18}\d/g, "").trim());if(n)u.name=n;}
   const number=msg.match(/\+?\d[\d ()-]{7,18}\d/);if(number)u.phone_number=number[0].replace(/[^\d+]/g,"");
   callback();
 }
 else if(call)callback();
 else if(refuse&&!uncertain)objectionChoice();
 else if((sellerIntent||statedPrice) && ["name","choice"].includes(b.basicStep))continueSeller();
 else if(!(c.messages||[]).some((m:any)=>m.role==="assistant") && !old.basicMode){reply="Hi, I'm Kaya, Mister Wheelz's virtual assistant. What’s your name?";b.basicStep="name";}
 else if(!statedPrice&&(inquiry.test(msg)||(objection&&!date&&!time&&!book&&!(vehicleStage&&/\b(not sure|unsure|unknown|don'?t know|dont know|do not know|no idea|not certain|gcc|non-gcc)\b/i.test(msg)))))objectionChoice();
 else if(immediate&&(["timeline","daytime","choice","objection_choice","inspection_window"].includes(b.basicStep)||b.basicStep==="vehicle"&&book)){
   if(b.basicStep==="timeline")u.sell_timeline=msg.slice(0,200);
   arrangeSoon();
 }
 else if(b.basicStep==="objection_choice"){
   if(book||yes||date||time){
     b.basicStep="daytime";
     if(date)b.proposedDate=date;if(time)b.proposedTime=time;
     if(b.proposedDate&&b.proposedTime){b.basicStep="contact";contact();}
     else reply=b.proposedDate?"To continue your booking, please type the time you can come.":"To continue your booking, please share your preferred inspection day and time.";
   }else if(statedPrice){reply="Thank you. To continue your booking, please share your preferred inspection day and time.";b.basicStep="daytime";}
   else callback();
 }
 else if(statedPrice&&!date&&!time&&!book&&["timeline","daytime","inspection_window","contact","confirm","choice"].includes(b.basicStep)){
   // A seller's expected amount is information, not an objection or a slot answer.
   reply="Thank you. "+(b.basicStep==="timeline"?"Please let me know when you plan to sell.":b.proposedDate?"Please type the time you can come for the inspection.":"Please share your preferred inspection day and time.");
 }
 else if(b.basicStep==="name"){
   const n=nameFrom(msg);
   if(n){u.name=n;b.basicStep="vehicle";reply="Which car are you planning to sell?";}
   else {b.offscript=true;b.basicStep="choice";reply=CHOICE;}
 }
 else if(b.basicStep==="vehicle"){
   if(book){b.basicStep="daytime";reply=SCHEDULE_QUESTION;}
   else if(statedPrice)nextVehicle();
   else if(/\b(sell|selling)\b/i.test(msg))continueSeller();
   else nextVehicle();
 }
 else if(b.basicStep==="timeline"){
   if(immediate){u.sell_timeline=msg.slice(0,200);arrangeSoon();}
   else if(book||/\b(today|tomorrow|week|month|year|asap|urgent|soon|now|immediately|ready|day|sell|selling)\b/i.test(msg)){
     if(!book)u.sell_timeline=msg.slice(0,200);
     b.basicStep="daytime";reply=SCHEDULE_QUESTION;
   }else callback();
 }
 else if(b.basicStep==="inspection_window"){
   if(/\bnext month\b/i.test(msg)){
     b.inspectionWindow="next_month";b.basicStep="daytime";b.proposedDate=undefined;b.proposedTime=undefined;
     reply="Which date and time next month would you like for the inspection?";
   }else if(/\bthis week\b/i.test(msg)){
     b.inspectionWindow="this_week";b.basicStep="daytime";reply=SCHEDULE_QUESTION;
   }else if(date||time){
     b.basicStep="daytime";if(date)b.proposedDate=date;if(time)b.proposedTime=time;
     if(b.proposedDate&&b.proposedTime){b.basicStep="contact";contact();}
     else reply=b.proposedDate?"What time do you want for the inspection?":"Which day do you want for the inspection?";
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
   if(!immediate){if(date)b.proposedDate=date;if(time)b.proposedTime=time;}
   if(immediate)arrangeSoon();
   else if(!date&&!time){callback();}
   else if(!b.proposedDate)reply="Which day do you want for the inspection?";
   else if(new Date(b.proposedDate+"T12:00:00Z").getUTCDay()===0)arrangeSoon();
   else if(!b.proposedTime)reply="What time do you want for the inspection?";
   else if(b.inspectionWindow==="next_month" && b.proposedDate.slice(0,7)!==new Date(Date.UTC(new Date(+now+4*3600e3).getUTCFullYear(),new Date(+now+4*3600e3).getUTCMonth()+1,1)).toISOString().slice(0,7)){
     b.proposedDate=undefined;b.proposedTime=undefined;reply="Please provide the date and time in the month you selected.";
   }
   else if(!slotValid(b.proposedDate,b.proposedTime,now)){
     const opens=new Date(b.proposedDate+"T12:00:00Z").getUTCDay()===5?"12 pm":"10 am";
     b.proposedTime=undefined;reply="That time isn't available. Please choose a time between "+opens+" and 6:30 pm on "+inspectionDay(b.proposedDate)+".";
   }
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
 if(uncertain&&reply&&!/^No problem[,.]/i.test(reply))reply="No problem. "+reply;
 if(media.kinds.length){
   const kinds=media.kinds.join(", ").replace(/, ([^,]+)$/, " or $1");
   reply="Unfortunately, I'm not able to open "+kinds+"."+(reply?" "+reply:"");
 }
 // Final guard applies to EVERY reply, including statements and callback prompts.
 // Keep sent text in state so trimming message history cannot re-enable repeats.
 const normalize=(s:string)=>s.toLowerCase().replace(/[’‘]/g,"'").replace(/[^a-z0-9]+/g," ").trim();
 const sent=new Set([...(old.sentReplies||[]),...history.filter(m=>m.role==="assistant").map(m=>normalize(m.content))]);
 if(reply&&sent.has(normalize(reply))){
   if(b.basicStep!=="done")callback();
   if(sent.has(normalize(reply)))reply="";
 }
 if(reply)sent.add(normalize(reply));
 b.sentReplies=[...sent];
 b.status=b.basicStep==="done" && action==="collecting" ? (old.status||"collecting") : action==="booked"?"booked":action==="callback"?"team_accepted":"collecting";
 u.flow_state={...old,...b,version:1};
 return {reply,updates:u,action,state:b};
}
export async function emergencyBasicTurn(c:Conversation,text:string) {
 const fields=await extractVehicleInfo(emergencyInput(text).text,{make:c.make||undefined,model:c.model||undefined,year:c.year||undefined}).catch(()=>({}));
 const turn=planEmergencyTurn(c,text,fields);
 const fresh=await getConversation(c.phone);
 const messages=[...(fresh?.messages||c.messages||[]),...(turn.reply?[{role:"assistant" as const,content:turn.reply}]:[])].slice(-40);
 // Record the request before telling the customer it is confirmed.
 await updateConversation(c.phone,{...turn.updates,messages,step:turn.action==="booked"?8:Math.max(c.step||0,1)});
 if(turn.reply)await sendWhatsAppMessage(c.phone,turn.reply);
 const saved=await getConversation(c.phone);
 if(saved && turn.action!=="collecting") {
   const note=EMERGENCY_MODE+" — "+turn.action+"\nSelling timeline: "+(saved.sell_timeline||"unknown")+"\nSeller asking price (not a valuation): "+((saved.flow_state as any)?.askingPriceAed||"not provided");
   const ok=await createBiginContact({...saved,phone_number:saved.phone_number||saved.phone,inspection_booked:turn.action==="booked",inquiry_summary:note,sales_inquiry:turn.action==="booked"?"Not Sure - Need Advise":"Other"} as any);
   if(ok){if(turn.action==="callback")await moveLeadToCallBack(c.phone);await updateConversation(c.phone,{bigin_pushed_at:new Date().toISOString(),inquiry_summary:note});}
   else console.error("[emergency] Bigin write not confirmed",c.phone);
 }
 return turn.action;
}
