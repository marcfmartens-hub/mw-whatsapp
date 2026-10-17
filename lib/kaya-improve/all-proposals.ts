import {PUBLIC_URL} from "./github";
import {randomUUID} from "crypto";
import {autoReview,approveProposal} from "./approve";
import {improveDb,settings} from "./store";
import {publishReady} from "./publisher";
const KIND="all_proposals";
/** Snapshot a durable queue. Automatic sweeps exclude terminal rejections. */
export async function queueAllProposals(actor:string,automatic=false){
 const state=await settings();if(!state.config.enabled||!state.config.autoApprove)throw Error("Enable Kaya Improve and automatic approval first");
 if(automatic&&!state.config.fullAutonomous)return {paused:true};
 const db=improveDb(),holder=randomUUID();
 const lease=await db.rpc("kaya_improve_lease",{lease_name:"all_proposals_queue",holder,release_lease:false});if(lease.error)throw lease.error;if(!lease.data)return{busy:true};
 try{
  const active=await db.from("mw_improve_runs").select("id").eq("kind",KIND).eq("status","running").limit(1);if(active.error)throw active.error;
  if(active.data?.length){
   if(!automatic){const row=await db.from("mw_improve_runs").select("summary").eq("id",active.data[0].id).single();if(row.error)throw row.error;const updated=await db.from("mw_improve_runs").update({summary:{...row.data.summary,automatic:false,actor}}).eq("id",active.data[0].id);if(updated.error)throw updated.error;}
   return{id:active.data[0].id,resumed:true};
  }
  const proposals:any[]=[];
  for(let offset=0;;offset+=200){
   const r=await db.from("mw_improve_proposals").select("*").in("status",automatic?["needs_admin","approved"]:["needs_admin","rejected","approved"]).is("release_id",null).order("created_at").range(offset,offset+199);if(r.error)throw r.error;
   proposals.push(...(r.data??[]));if((r.data??[]).length<200)break;
  }
  if(!proposals.length)return{empty:true};
  const id=`all-proposals:${randomUUID()}`;
  const saved=await db.from("mw_improve_runs").insert({id,kind:KIND,status:"running",summary:{actor,automatic,ids:proposals.map(p=>p.id),completed:[],blocked:[],errors:[],requested:proposals.length}});if(saved.error)throw saved.error;
  const drain=await db.from("mw_improve_runs").insert({id:`approved-processing:${randomUUID()}`,kind:"approved_processing",status:"running",summary:{actor,queue:id}});if(drain.error)throw drain.error;
  return{id,requested:proposals.length};
 }finally{await db.rpc("kaya_improve_lease",{lease_name:"all_proposals_queue",holder,release_lease:true});}
}
/** One proposal per invocation; cron resumes the durable cursor without admin. */
export async function processAllProposals(){
 const state=await settings();if(!state.config.enabled||!state.config.autoApprove)return{paused:true};
 const db=improveDb(),holder=randomUUID();
 const lease=await db.rpc("kaya_improve_lease",{lease_name:KIND,holder,release_lease:false});if(lease.error)throw lease.error;if(!lease.data)return{busy:true};
 try{
  const result=await db.from("mw_improve_runs").select("*").eq("kind",KIND).eq("status","running").order("started_at").limit(1);if(result.error)throw result.error;
  const run=result.data?.[0];if(!run)return{idle:true};
  const summary=run.summary;
  if(summary.automatic&&!state.config.fullAutonomous)return{paused:true};
  const id=summary.ids[0];
  if(id){
   const row=await db.from("mw_improve_proposals").select("*").eq("id",id).single();if(row.error)throw row.error;
   const p=row.data;
   try{
    if(!p.release_id&&p.status!=="approved"&&p.status!=="published"){
     if(p.intent&&p.phrase)await approveProposal(id,summary.actor);
     else{
      if(!p.evidence?.phone)throw Error("No source conversation; cannot generate an executable fix");
      const chat=await db.from("mw_whatsapp").select("*").eq("phone",p.evidence.phone).single();if(chat.error)throw chat.error;
      await autoReview(chat.data,undefined,`${run.id}:${id}`);
      const checked=await db.from("mw_improve_proposals").select("status,release_id").eq("id",id).single();if(checked.error)throw checked.error;
      if(checked.data.status==="needs_admin"&&!checked.data.release_id)throw Error("Source re-reviewed. No supported executable fix for this finding; requires a code change outside the learning protocol");
     }
    }
    summary.completed.push(id);
   }catch(e){
    const reason=e instanceof Error?e.message:String(e);
    // Keep provider interruptions retryable without approving a failed candidate.
    if(/timeout|timed out|429|529|503|fetch failed|overloaded/i.test(reason)){summary.errors.push({id,reason});const saved=await db.from("mw_improve_runs").update({summary,error:reason}).eq("id",run.id);if(saved.error)throw saved.error;return{retrying:id};}
    summary.blocked.push({id,reason});
    const blocked=await db.from("mw_improve_proposals").update({status:"rejected",validation:{...p.validation,batch_review:{passed:false,reason,actor:summary.actor}},updated_at:new Date().toISOString()}).eq("id",id).is("release_id",null).in("status",["needs_admin","rejected"]);if(blocked.error)throw blocked.error;
   }
   summary.ids=summary.ids.slice(1);
  }
  const done=!summary.ids.length;
  const saved=await db.from("mw_improve_runs").update({summary,error:null,status:done?"completed":"running",...(done?{finished_at:new Date().toISOString()}: {})}).eq("id",run.id);if(saved.error)throw saved.error;
  await publishReady({processNow:true});
  return{remaining:summary.ids.length,completed:summary.completed.length,blocked:summary.blocked.length};
 }finally{await db.rpc("kaya_improve_lease",{lease_name:KIND,holder,release_lease:true});}
}

/** Continue in separate function budgets; the durable cursor survives delivery failure. */
export async function runAllProposalsStep(){
 const result=await processAllProposals();
 if("remaining" in result&&result.remaining>0){
  const response=await fetch(`${PUBLIC_URL}/api/kaya-improve/all`,{method:"POST",headers:{Authorization:`Bearer ${process.env.KAYA_IMPROVE_SECRET}`},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error(`Proposal continuation not accepted (${response.status}); recovery cron will retry`);
 }
 return result;
}
