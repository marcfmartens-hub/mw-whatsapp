// Contact success alone is insufficient: the team's pipeline card must exist too.
const BASE = "https://www.zohoapis.com/bigin/v2";
export type BiginOutcome = "booked" | "callback";
export type PipelineTarget = { id:string; name:string; sub:string; stage:string };
async function read(url:string,token:string) {
 const r=await fetch(url,{headers:{Authorization:`Zoho-oauthtoken ${token}`},cache:"no-store",signal:AbortSignal.timeout(15000)});
 if(r.status===204)return {data:[]};
 const body=await r.json();
 if(!r.ok)throw new Error(`Bigin read ${r.status}: ${body?.code||body?.message||"failed"}`);
 return body;
}
export async function pipelineTarget(token:string,outcome:BiginOutcome):Promise<PipelineTarget>{
 const {layouts=[]}=await read(`${BASE}/settings/layouts?module=Pipelines`,token);
 const layoutsSorted=[...layouts].sort((a:any,b:any)=>Number(!/whatsapp/i.test(a.name))-Number(!/whatsapp/i.test(b.name)));
 const stages=outcome==="callback"?["Call Back"]:["Booking","New Booking","Booked Appointments","New Appointments - Chat Bot"];
 for(const layout of layoutsSorted){
  // Use the existing bot's team pipeline; never insert in an unrelated staff pipeline.
  if(!/whatsapp/i.test(layout.name))continue;
  const fields=(layout.sections||[]).flatMap((s:any)=>s.fields||[]);
  const subs=fields.find((f:any)=>f.api_name==="Sub_Pipeline")?.pick_list_values||[];
  for(const stage of stages)for(const sub of subs){
   const mapped=(sub.maps||[]).flatMap((m:any)=>m.api_name==="Stage"?m.pick_list_values||[]:[]);
   if(mapped.some((v:any)=>(v.actual_value||v.display_value)===stage))return {id:layout.id,name:layout.name,sub:sub.actual_value||sub.display_value,stage};
  }
 }
 throw new Error(`No WhatsApp sub-pipeline configured for ${outcome}`);
}
export async function ensureBiginPipeline(contactId:string,c:any,token:string):Promise<{contactId:string;pipelineId:string;stage:string;teamPipelineId:string}>{
 const outcome:BiginOutcome=c.bigin_outcome;
 const target=await pipelineTarget(token,outcome);
 const rows=await read(`${BASE}/Contacts/${contactId}/Pipelines?pipeline_id=${target.id}&fields=Deal_Name,Stage,Sub_Pipeline,Created_Time`,token);
 const existing=(rows.data||[]).filter((r:any)=>r.Sub_Pipeline===target.sub).sort((a:any,b:any)=>String(b.Created_Time||"").localeCompare(String(a.Created_Time||"")))[0];
 const managed=["Booking","New Booking","Booked Appointments","New Appointments - Chat Bot","Call Back","New Message","No Response"];
 if(existing&&!managed.includes(existing.Stage)){
   const check=await read(`${BASE}/Pipelines/${existing.id}?fields=Stage,Contact_Name`,token);
   const saved=check.data?.[0];
   if(!saved||String(saved.Contact_Name?.id)!==contactId)throw new Error("Staff card contact verification failed");
   console.log(`[Bigin] preserving staff-managed card=${existing.id} stage=${saved.Stage}`);
   return {contactId,pipelineId:String(existing.id),stage:saved.Stage,teamPipelineId:target.id};
 }
 const data:Record<string,any>={
  Deal_Name:([c.name||c.make||"WhatsApp seller",c.make,c.model,c.year].filter(Boolean).join(" · ")+" · "+String(c.phone||c.phone_number||"").slice(-4)).slice(0,255),
  Pipeline:{id:target.id},Sub_Pipeline:target.sub,Stage:target.stage,Contact_Name:{id:contactId},
  Lead_Source:"WhatsApp Bot",Inspection_Booked:outcome==="booked"?"Yes":"No",
  Conversation_Phone_Number:String(c.phone||c.phone_number||""),Phone_Number:String(c.phone_number||c.phone||""),
  Inquiry_Summary:c.inquiry_summary||"",Sell_Time:c.sell_timeline||"",
 };
 for(const [key,value]of Object.entries({Make:c.make,Model:c.model,Year:c.year,Mileage:c.mileage,Regional_Specs:c.specs}))if(value)data[key]=String(value);
 if(c.flow_state?.askingPriceAed)data.Asking_Price=Number(c.flow_state.askingPriceAed);
 if(outcome==="booked"){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(c.appointment_date||"")||!/^\d{2}:\d{2}$/.test(c.appointment_time||""))throw new Error("Booked handoff needs an exact appointment date and time");
  data.Appointment_Date=c.appointment_date;data.Appointment_Time=c.appointment_time;
  data.Appointment_Date_and_Time=`${c.appointment_date}T${c.appointment_time}:00+04:00`;
 }else {data.Appointment_Date=null;data.Appointment_Time=null;data.Appointment_Date_and_Time=null;}
 if(existing){
  data.id=existing.id;
  // Reconciliation must not roll a card back after staff have advanced it.
  if(!["Booking","New Booking","Booked Appointments","New Appointments - Chat Bot","Call Back","New Message","No Response"].includes(existing.Stage))delete data.Stage;
 }
 const r=await fetch(`${BASE}/Pipelines`,{method:existing?"PUT":"POST",headers:{Authorization:`Zoho-oauthtoken ${token}`,"Content-Type":"application/json"},body:JSON.stringify({data:[data],trigger:[]}),signal:AbortSignal.timeout(15000)});
 const result=await r.json();const row=result?.data?.[0];
 if(!r.ok||row?.status!=="success"||!row?.details?.id)throw new Error(`Bigin pipeline write failed: ${r.status} ${JSON.stringify(result).slice(0,450)}`);
 const pipelineId=String(row.details.id);
 const check=await read(`${BASE}/Pipelines/${pipelineId}?fields=Stage,Sub_Pipeline,Contact_Name,Appointment_Date_and_Time`,token);
 const saved=check.data?.[0];
 const expectedStage=data.Stage||existing?.Stage;
 if(!saved||saved.Stage!==expectedStage||String(saved.Contact_Name?.id)!==contactId)throw new Error("Bigin pipeline read-back did not verify stage and contact");
 if(outcome==="booked"&&Date.parse(saved.Appointment_Date_and_Time||"")!==Date.parse(data.Appointment_Date_and_Time))throw new Error("Bigin appointment read-back did not match date/time");
 console.log(`[Bigin] pipeline verified outcome=${outcome} contact=${contactId} card=${pipelineId} stage=${saved.Stage}`);
 return {contactId,pipelineId,stage:saved.Stage,teamPipelineId:target.id};
}
