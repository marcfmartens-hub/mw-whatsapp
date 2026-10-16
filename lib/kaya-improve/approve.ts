import {watchDeployedLearning} from "./watch";
import {replayGate,replayInput,successfulReplayInputs} from "./replay";
import {COMMUNICATION_SKILLS} from "./skills";
import { createHash, randomUUID } from "crypto";
import catalog from "./learning.json";
import { Chat, detect } from "./detect";
import { independentlyValidate, propose, safeEvidence, retryableReviewError } from "./reviewer";
import { validateLearning, validateCandidate } from "./learning";
import { improveDb, settings } from "./store";
import { hash, publishReady, successfulMessages } from "./publisher";
import { AUTO_POLICY } from "./auto-policy";
export async function autoReview(chat:Chat, findingCode?:string){
 const state=await settings();if(!state.config.enabled||!state.config.autoApprove)return;
 const db=improveDb(),evidence=safeEvidence(chat),fingerprint=hash(JSON.stringify({evidence,step:chat.step,date:chat.appointment_date,time:chat.appointment_time})),runId=`auto-review:${AUTO_POLICY.version}:${chat.phone}:${fingerprint}${findingCode?":"+findingCode:""}`;
 // Correct recorded bookings get lightweight checks; deeper review targets problems/non-bookings.
 const detected=detect(chat),needsReview=true;
 if(findingCode&&!detected.findings.some(f=>f.code===findingCode))throw Error("Finding no longer applies; analyze this chat again");
 if(!needsReview){await publishReady();return;}
 const claimed=await db.from("mw_improve_runs").insert({id:runId,kind:"auto_approval",status:"running"});
 if(claimed.error?.code==="23505"){
  const old=await db.from("mw_improve_runs").select("status,started_at,finished_at").eq("id",runId).single();if(old.error)throw old.error;
  const retryable=["failed","skipped"].includes(old.data.status)&&Date.now()-Date.parse(old.data.finished_at??old.data.started_at)>60000;
  const expired=old.data.status==="running"&&Date.now()-Date.parse(old.data.started_at)>15*60000;
  if(!retryable&&!expired){await publishReady();return;}
  const retried=await db.from("mw_improve_runs").update({status:"running",started_at:new Date().toISOString(),finished_at:null,error:null}).eq("id",runId).eq("status",old.data.status).select("id");if(retried.error)throw retried.error;if(!retried.data?.length)return;
 }else if(claimed.error)throw claimed.error;
 const holder=randomUUID();const lease=await db.rpc("kaya_improve_lease",{lease_name:`review:${chat.phone}`,holder,release_lease:false});if(lease.error){await db.from("mw_improve_runs").update({status:"failed",finished_at:new Date().toISOString(),error:lease.error.message}).eq("id",runId);throw lease.error;}
 if(!lease.data){await db.from("mw_improve_runs").update({status:"skipped",finished_at:new Date().toISOString(),summary:{reason:"A review for this conversation is already running"}}).eq("id",runId);return;}
 try{
  if(!findingCode&&await watchDeployedLearning(chat)){await db.from("mw_improve_runs").update({status:"completed",finished_at:new Date().toISOString(),summary:{production_regression:true,publishing_paused:true}}).eq("id",runId);return;}
  const suggestions=await propose(chat,findingCode),successful=await successfulMessages(),before=validateLearning(catalog);let approved=0,pending=0,rejected=0,retryable=0;
  for(const s of suggestions){
   const control=await settings();if(!control.config.enabled||!control.config.autoApprove){await db.from("mw_improve_runs").update({status:"skipped",finished_at:new Date().toISOString(),summary:{reason:"Automation switched off"}}).eq("id",runId);return;}
   const id=createHash("sha256").update(s.manual?`${fingerprint}:${s.reason}`:s.skill?`skill:${AUTO_POLICY.version}:${s.skill}:${fingerprint}`:`${s.intent}:${s.phrase}`).digest("hex");
   let attempts=0;const exists=await db.from("mw_improve_proposals").select("id").eq("id",id).maybeSingle();if(exists.error)throw exists.error;if(exists.data){const prior=await db.from("mw_improve_proposals").select("status,validation").eq("id",id).single();if(prior.error)throw prior.error;attempts=prior.data.validation?.attempts??0;if(prior.data.status!=="rejected"||!prior.data.validation?.retryable||attempts>=3)continue;}
   if(s.manual){const r=await db.from("mw_improve_proposals").insert({id,status:"needs_admin",severity:s.severity,reason:s.reason,evidence:{conversation:evidence,policy:AUTO_POLICY.version}});if(r.error)throw r.error;pending++;continue;}
   if(s.skill&&(before.skills??[]).includes(s.skill))continue;
   const alias={phrase:s.phrase!,intent:s.intent!};let validation:Record<string,unknown>,status:string;
   try{
    const independent=await independentlyValidate(s.skill?{skill:s.skill}:alias,chat);if(!independent.passed)throw Error(`Independent review rejected: ${independent.reason}`);
    const candidate=validateLearning({version:1,aliases:s.skill?before.aliases:[...before.aliases,alias],skills:s.skill?[...(before.skills??[]),s.skill]:before.skills});
    const tests=validateCandidate(before,candidate,successful);
    const source=replayInput(chat,"Observed issue",s.phrase);
    const replay=await replayGate(before,candidate,[source],await successfulReplayInputs());
    validation={...tests,independent,replay,replay_source:source,policy:AUTO_POLICY.version,base_hash:hash(JSON.stringify(before)),evidence_hash:fingerprint};status="approved";approved++;
   }catch(e){validation={passed:false,reason:e instanceof Error?e.message:String(e),policy:AUTO_POLICY.version,retryable:retryableReviewError(e),attempts:attempts+1};if(validation.retryable)retryable++;status="rejected";rejected++;}
   const position=(chat.messages??[]).findIndex(m=>m.role==="user"&&m.content.toLowerCase().trim().replace(/[.!?,]+$/g,"").replace(/\s+/g," ")===alias.phrase);
   const response=position>=0?(chat.messages??[]).slice(position+1).find(m=>m.role==="assistant")?.content??"":"";
   const severity=s.severity==="critical"&&detected.findings.some(f=>f.severity==="critical")?"critical":alias.intent==="customer_will_call"&&/\b(?:our team|we|someone)\b.{0,40}\b(?:will call|will contact|will be in touch)/i.test(response)?"critical":"minor";
   const r=await db.from("mw_improve_proposals").upsert({id,status,severity,...(s.skill?{intent:"communication_skill",phrase:s.skill}:alias),reason:s.reason,evidence:{conversation:evidence,solution:s.skill?COMMUNICATION_SKILLS[s.skill]:alias,policy:AUTO_POLICY.version},validation});if(r.error&&r.error.code!=="23505")throw r.error;
  }
  // Deterministic serious findings outside the allowed patch scope always remain visible.
  for(const f of detected.findings.filter(f=>findingCode?f.code===findingCode&&approved===0&&pending===0:f.severity==="critical")){
   pending++;const id=hash(`${fingerprint}:${f.code}`);const r=await db.from("mw_improve_proposals").upsert({id,status:"needs_admin",severity:f.severity==="critical"?"critical":"minor",reason:f.message,evidence:{code:f.code,conversation:evidence,suggestion:f.suggestion,policy:AUTO_POLICY.version}},{onConflict:"id",ignoreDuplicates:true});if(r.error)throw r.error;
  }
  const done=await db.from("mw_improve_runs").update({status:retryable?"failed":"completed",finished_at:new Date().toISOString(),summary:{retryable,approved,needs_admin:pending,rejected,outcome:suggestions.length||detected.findings.length?"issues_reviewed":"normal_conversation",finding_code:findingCode??null,phone:chat.phone,policy:AUTO_POLICY.version}}).eq("id",runId);if(done.error)throw done.error;
 }catch(e){await db.from("mw_improve_runs").update({status:"failed",finished_at:new Date().toISOString(),error:e instanceof Error?e.message:String(e)}).eq("id",runId);throw e;
 }finally{await db.rpc("kaya_improve_lease",{lease_name:`review:${chat.phone}`,holder,release_lease:true});}
 await publishReady();
}
