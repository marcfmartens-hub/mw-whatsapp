import {randomUUID} from "crypto";
import {autoReview} from "./approve";
import {safeEvidence} from "./reviewer";
import {improveDb,settings} from "./store";
import {publishReady} from "./publisher";
import {Chat} from "./detect";
const KIND="pending_reviews";
const validPhone=(phone:string)=>/^\d{8,16}$/.test(phone)&&!/^971599900/.test(phone);
// Evidence matching supports proposals created before source phones were recorded.
export function pendingPhones(proposals:any[],reviews:any[],chats:Chat[]){
 const phones=new Set<string>(reviews.filter(r=>r.findings?.length).map(r=>r.phone));
 for(const p of proposals){
  if(p.evidence?.phone)phones.add(p.evidence.phone);
  const evidence=p.evidence?.conversation;
  if(!Array.isArray(evidence))continue;
  const original=JSON.stringify(evidence);
  for(const chat of chats){
   const current=safeEvidence(chat);
   if(JSON.stringify(current)===original||evidence.length>=2&&current.length>=evidence.length&&JSON.stringify(current.slice(-evidence.length))===original)phones.add(chat.phone);
  }
 }
 return [...phones].filter(validPhone).sort();
}
export async function queuePendingReviews(){
 const state=await settings();if(!state.config.enabled||!state.config.autoApprove)throw Error("Enable Kaya Improve and automatic approval first");
 const db=improveDb();
 const active=await db.from("mw_improve_runs").select("id").eq("kind",KIND).eq("status","running").limit(1);if(active.error)throw active.error;
 if(active.data?.length)return{id:active.data[0].id,resumed:true};
 const [proposals,reviews,chats]=await Promise.all([
  db.from("mw_improve_proposals").select("*").in("status",["approved","needs_admin"]).is("release_id",null).limit(1000),
  db.from("mw_improve_reviews").select("phone,findings").limit(1000),
  db.from("mw_whatsapp").select("*").order("last_message_at",{ascending:false}).limit(1000),
 ]);
 for(const result of [proposals,reviews,chats])if(result.error)throw result.error;
 const phones=pendingPhones(proposals.data??[],reviews.data??[],chats.data??[]);
 const id=`pending:${randomUUID()}`;
 const inserted=await db.from("mw_improve_runs").insert({id,kind:KIND,status:"running",summary:{phones,completed:[],errors:[],requested:phones.length}});if(inserted.error)throw inserted.error;
 return{id,requested:phones.length};
}
// One source per invocation keeps provider-heavy reviews within the function budget.
// The cursor is durable; cron and the monitor both resume it under the same lease.
export async function processPendingReviews(){
 const state=await settings();if(!state.config.enabled||!state.config.autoApprove)return{paused:true};
 const db=improveDb(),holder=randomUUID();
 const lease=await db.rpc("kaya_improve_lease",{lease_name:KIND,holder,release_lease:false});if(lease.error)throw lease.error;if(!lease.data)return{busy:true};
 try{
  const active=await db.from("mw_improve_runs").select("*").eq("kind",KIND).eq("status","running").order("started_at").limit(1);if(active.error)throw active.error;
  const run=active.data?.[0];if(!run)return{idle:true};
  const summary=run.summary,phone=summary.phones[0];
  if(phone){
   const row=await db.from("mw_whatsapp").select("*").eq("phone",phone).single();
   try{if(row.error)throw row.error;await autoReview(row.data,undefined,run.id);summary.completed.push(phone);}
   catch(e){summary.errors.push({phone,reason:e instanceof Error?e.message:String(e)});}
   summary.phones=summary.phones.slice(1);
  }
  const done=!summary.phones.length;
  const saved=await db.from("mw_improve_runs").update({summary,status:done?(summary.errors.length?"failed":"completed"):"running",...(done?{finished_at:new Date().toISOString()}: {})}).eq("id",run.id);if(saved.error)throw saved.error;
  if(done)await publishReady({processNow:true});
  return{remaining:summary.phones.length,completed:summary.completed.length,errors:summary.errors.length};
 }finally{await db.rpc("kaya_improve_lease",{lease_name:KIND,holder,release_lease:true});}
}
