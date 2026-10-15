import { createHash, randomUUID } from "crypto";
import { improveDb, settings } from "./store";
import { RunId } from "./config";
import { Chat, detect, regression } from "./detect";
export async function runCheck(kind:RunId, source:"manual"|"bigin"="manual", phone?:string, snapshot?:Chat) {
  const state=await settings();
  const schedule=state.config.schedules[kind];
  if(!state.config.enabled || schedule.mode==="off") return {skipped:"Disabled"};
  const db=improveDb();
  const seconds=source==="bigin"?1:60;
  const id=`${kind}:${source}:${phone??"all"}:${Math.floor(Date.now()/(seconds*1000))}`;
  const claim=await db.from("mw_improve_runs").insert({id,kind,status:"running"});
  if(claim.error?.code==="23505") return {skipped:"Already claimed"};
  if(claim.error) throw new Error(claim.error.message);
  try {
    let summary:Record<string,unknown>={};
    if(kind==="regression") {
      const tests=regression();
      const {data,error}=await db.from("mw_improve_reviews").select("findings");if(error) throw error;
      const groups:Record<string,number>={};
      for(const row of data??[]) for(const f of row.findings??[]) groups[f.code]=(groups[f.code]??0)+1;
      summary={tests,passed:tests.every(t=>t.passed),recurring_issues:groups,publishing:"See the separate auto-approval queue: only exact contact-language aliases are eligible."};
    } else if(kind==="review") {
      const {data,error}=await db.from("mw_improve_reviews").select("phone,outcome,findings").order("reviewed_at",{ascending:false}).limit(200);if(error) throw error;
      summary={reviewed:(data??[]).filter(r=>r.findings.length).length,proposals:(data??[]).filter(r=>r.findings.length).map(r=>({phone:r.phone,corrections:r.findings.map((f:{suggestion:string})=>f.suggestion)})),method:"Rule-based suggestions. Separate auto-approval reviews may use AI for supported language aliases."};
    } else {
      let query=db.from("mw_whatsapp").select("phone,name,step,appointment_date,appointment_time,bigin_pushed_at,car_conditions,messages,last_message_at").order("last_message_at",{ascending:false}).limit(200);
      if(phone) query=query.eq("phone",phone);
      const {data,error}=snapshot?{data:[snapshot],error:null}:await query;if(error) throw error;
      let checked=0,flagged=0;
      for(const row of data??[]) {
        if(!/^\d+$/.test(row.phone) || /^971599900/.test(row.phone)) continue;
        const fingerprint=createHash("sha256").update(JSON.stringify(row)).digest("hex");
        const previous=await db.from("mw_improve_reviews").select("fingerprint").eq("phone",row.phone).maybeSingle();if(previous.error) throw previous.error;
        if(previous.data?.fingerprint===fingerprint && source!=="manual") continue;
        const result=detect(row as Chat);
        const saved=await db.from("mw_improve_reviews").upsert({phone:row.phone,fingerprint,outcome:result.outcome,findings:result.findings,verification_note:result.verification_note,reviewed_at:new Date().toISOString()});if(saved.error) throw saved.error;
        checked++;if(result.findings.length) flagged++;
      }
      summary={checked,flagged,method:"Read-only rule checks. Bookings require live CRM and consent verification."};
    }
    const done=await db.from("mw_improve_runs").update({status:"completed",finished_at:new Date().toISOString(),summary}).eq("id",id);if(done.error) throw done.error;
    return summary;
  } catch(e) {
    await db.from("mw_improve_runs").update({status:"failed",finished_at:new Date().toISOString(),error:e instanceof Error?e.message:String(e)}).eq("id",id);
    throw e;
  }
}

export function recentChatLimit(value:unknown):number {
 if(typeof value!=="number"||!Number.isInteger(value)||value<1||value>100)throw Error("Choose between 1 and 100 chats");
 return value;
}
export async function analyzeRecentChats(value:unknown) {
 const limit=recentChatLimit(value);
 if(!(await settings()).config.enabled)throw Error("Kaya Improve is switched off");
 const db=improveDb(),id=`recent:${randomUUID()}`;
 const claim=await db.from("mw_improve_runs").insert({id,kind:"recent_chats",status:"running"});if(claim.error)throw claim.error;
 try {
  const {data,error}=await db.from("mw_whatsapp").select("phone,name,step,appointment_date,appointment_time,bigin_pushed_at,car_conditions,messages,last_message_at").not("last_message_at","is",null).order("last_message_at",{ascending:false}).order("phone").limit(limit+100);
  if(error)throw error;
  const chats=(data??[]).filter(row=>/^\d{8,16}$/.test(row.phone)&&!/^971599900/.test(row.phone)).slice(0,limit);
  const results=[];
  for(const row of chats){
   if(!(await settings()).config.enabled){const r=await db.from("mw_improve_runs").update({status:"skipped",finished_at:new Date().toISOString(),summary:{requested:limit,checked:results.length,reason:"Switched off",results}}).eq("id",id);if(r.error)throw r.error;return{checked:results.length,stopped:true};}
   const result=detect(row as Chat);
   const saved=await db.from("mw_improve_reviews").upsert({phone:row.phone,fingerprint:createHash("sha256").update(JSON.stringify(row)).digest("hex"),outcome:result.outcome,findings:result.findings,verification_note:result.verification_note,reviewed_at:new Date().toISOString()});if(saved.error)throw saved.error;
   results.push({phone:row.phone,...result});
  }
  const summary={requested:limit,checked:results.length,flagged:results.filter(r=>r.findings.length).length,method:"Manual read-only checks; no changes to customer messages, CRM or code",results};
  const saved=await db.from("mw_improve_runs").update({status:"completed",finished_at:new Date().toISOString(),summary}).eq("id",id);if(saved.error)throw saved.error;
  return summary;
 }catch(e){await db.from("mw_improve_runs").update({status:"failed",finished_at:new Date().toISOString(),error:e instanceof Error?e.message:String(e)}).eq("id",id);throw e;}
}
