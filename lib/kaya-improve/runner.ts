import { createHash } from "crypto";
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
      summary={tests,passed:tests.every(t=>t.passed),recurring_issues:groups,publishing:"Unavailable: locked policy approval and full Kaya response regression gate are not yet connected"};
    } else if(kind==="review") {
      const {data,error}=await db.from("mw_improve_reviews").select("phone,outcome,findings").order("reviewed_at",{ascending:false}).limit(200);if(error) throw error;
      summary={reviewed:(data??[]).filter(r=>r.findings.length).length,proposals:(data??[]).filter(r=>r.findings.length).map(r=>({phone:r.phone,corrections:r.findings.map((f:{suggestion:string})=>f.suggestion)})),method:"Rule-based suggestions; no AI rewrite or publishing"};
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
