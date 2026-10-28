import { createHash } from "node:crypto";
const text=(v:unknown,n=300)=>typeof v==="string"?v.trim().slice(0,n):"";
const known=(v:unknown)=>{const s=text(v);return /^(unknown|n\/a|none|null|undefined|not (known|provided)|\?)$/i.test(s)?"":s;};
const phone=(v:unknown)=>{let d=String(v||"").replace(/\D/g,"");if(d.startsWith("00"))d=d.slice(2);if(/^05\d{8}$/.test(d))d="971"+d.slice(1);return d.length>=7&&d.length<=16?"+"+d:"";};
export function consolePayload(c:any){
 let name=known(c.name);
 if(!name&&Array.isArray(c.messages))for(let i=0;i<c.messages.length-1&&!name;i++){
  if(c.messages[i].role==="assistant"&&c.messages[i+1].role==="user"&&/\b(your name|may i (know|have) your name)\b/i.test(c.messages[i].content)){
   const m=String(c.messages[i+1].content).trim().replace(/^(hi|hello|hey)[,!\s]+/i,"").match(/^(?:(?:my name is|i am|i'm|this is|it's)\s+)?([A-Za-z][A-Za-z'-]{1,20})(?:\s+([A-Za-z][A-Za-z'-]{1,20}))?[.!\s]*$/i);
   if(m)name=[m[1],m[2]].filter(Boolean).join(" ");
  }
 }
 const sender=phone(c.phone_number||c.phone),alternate=phone(c.alternative_phone),primary=alternate&&alternate!==sender?alternate:sender;
 const appointment=c.clear_appointment?{clear:true}:c.inspection_booked!==false&&c.appointment_date&&c.appointment_time?{date:text(c.appointment_date,10),time:text(c.appointment_time,5)}:{};
 const result:any={schemaVersion:1,sourceId:String(c.id||c.phone||c.phone_number||"").slice(0,160),observedAt:c.last_message_at||c.created_at||new Date().toISOString(),
  contact:{name,phone:primary,alternativePhone:primary!==sender?sender:"",email:text(c.email,160)},
  vehicle:{make:known(c.make),model:known(c.model),year:c.year||null,mileage:c.mileage??null,specs:known(c.specs),option:known(c.option)},
  appointment,summary:[text(c.inquiry_summary,3000),text(c.car_conditions,500),c.sell_timeline?"Selling timeline: "+text(c.sell_timeline,200):"",c.loan?"Loan: "+text(c.loan,100):"",c.mortgage_amount?"Outstanding balance: "+text(c.mortgage_amount,100):"",c.owner_status?"Ownership: "+text(c.owner_status,100):""].filter(Boolean).join("\n").slice(0,4000),askingPrice:text(c.estimated_price||String(c.flow_state?.askingPriceAed||""),160),
  milestone:text(c.milestone_tag,40),reason:c.bigin_outcome==="booked"||c.inspection_booked?"Booking requested":"Call Back",
  marketing:{medium:c.source_url?"Meta ad (WhatsApp)":"WhatsApp",content:text(c.source_url,250)}};
 result.eventId=createHash("sha256").update(JSON.stringify(result)).digest("hex");
 return result;
}

