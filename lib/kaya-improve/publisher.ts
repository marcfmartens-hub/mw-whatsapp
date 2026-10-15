import { createHash, randomUUID } from "crypto";
import { Github, PUBLIC_URL } from "./github";
import { improveDb, settings } from "./store";
import { AUTO_POLICY, checkPublishGate, releaseDue } from "./auto-policy";
import { Learning, validateCandidate, validateLearning } from "./learning";
export const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
export async function connectionStatus(){
 const db=improveDb();const {data,error}=await db.from("mw_improve_connection").select("hook_id").eq("id",true).maybeSingle();if(error)throw Error(error.message);
 return{token:!!process.env.KAYA_GITHUB_TOKEN,webhookSecret:!!process.env.KAYA_GITHUB_WEBHOOK_SECRET,webhook:!!data?.hook_id,ready:!!(process.env.KAYA_GITHUB_TOKEN&&process.env.KAYA_GITHUB_WEBHOOK_SECRET&&data?.hook_id)};
}
export async function connectPublisher(){
 if(!process.env.KAYA_GITHUB_WEBHOOK_SECRET)throw Error("Webhook verification secret is not configured");
 const gh=new Github();const hooks=await gh.request("/hooks");const existing=hooks.find((h:any)=>h.config?.url===`${PUBLIC_URL}/api/kaya-improve/github`);
 const body={name:"web",active:true,events:["check_run","status","deployment_status"],config:{url:`${PUBLIC_URL}/api/kaya-improve/github`,content_type:"json",secret:process.env.KAYA_GITHUB_WEBHOOK_SECRET,insecure_ssl:"0"}};
 const hook=existing?await gh.request(`/hooks/${existing.id}`,"PATCH",body):await gh.request("/hooks","POST",body);
 const result=await improveDb().from("mw_improve_connection").upsert({id:true,hook_id:hook.id,checked_at:new Date().toISOString()});if(result.error)throw result.error;return{ok:true};
}
export async function successfulMessages(){
 const db=improveDb();const messages:string[]=[];let offset=0;
 while(offset<5000){const {data,error}=await db.from("mw_whatsapp").select("messages").not("appointment_date","is",null).range(offset,offset+199);if(error)throw error;
  for(const row of data??[])for(const m of row.messages??[])if(m.role==="user")messages.push(m.content);
  if((data??[]).length<200)return messages;offset+=200;
 }
 throw Error("Successful-chat corpus exceeds safety limit; extend regression coverage before publishing");
}
async function saveRelease(id:string,update:Record<string,unknown>){const r=await improveDb().from("mw_improve_releases").update(update).eq("id",id);if(r.error)throw r.error;}
async function doProgressRelease(release:any){
 const control=await settings();if(!control.config.enabled)return;
 const gh=new Github();
 if(release.status==="deploying"){
  const checks=await gh.checks(release.merge_sha);
  if(checks.failed){await saveRelease(release.id,{status:"deployment_failed",error:"Production checks failed; inspect the deployment before restoring."});return;}
  if(await gh.productionReady(release.merge_sha)){await saveRelease(release.id,{status:"published",published_at:new Date().toISOString()});const r=await improveDb().from("mw_improve_proposals").update({status:"published"}).eq("release_id",release.id);if(r.error)throw r.error;}
  return;
 }
 if(release.status!=="ci_pending")return;
 const checks=await gh.checks(release.head_sha);if(checks.failed){await saveRelease(release.id,{status:"tests_failed",error:"CI or preview failed; nothing merged"});return;}if(!checks.ci||!checks.preview)return;
 const state=await settings();if(!release.rollback_of&&(!state.config.enabled||!state.config.autoApprove))return;
 const main=await gh.main();if(main.sha!==release.base_sha){await saveRelease(release.id,{status:"stale",error:"Main changed during testing. Candidate must be rebuilt and revalidated."});return;}
 const pr=await gh.request(`/pulls/${release.pr_number}`);if(pr.head.sha!==release.head_sha)throw Error("Candidate branch changed after approval");
 const files=await gh.request(`/pulls/${release.pr_number}/files?per_page=100`);
 const current=await gh.file(AUTO_POLICY.allowedPath,release.head_sha);if(hash(current)!==release.validation.candidate_hash)throw Error("Candidate file differs from validated backup");
 if(hash(await gh.file("lib/kaya-improve/history.json",release.head_sha))!==release.validation.backup_index_hash)throw Error("Backup index differs from the validated release");
 checkPublishGate({enabled:true,hasBackup:!!release.backup?.before,validated:release.validation.passed===true,ci:checks.ci,preview:checks.preview,baseMatches:main.sha===release.base_sha,files:files.map((f:any)=>f.filename)});
 // Non-forced fast-forward is the atomic stale-base guard. A concurrent main
 // commit makes this fail instead of merging an untested base. Branch protection
 // may reject direct updates; that leaves the release blocked for Super Admin.
 const latest=await settings();if(!latest.config.enabled||(!release.rollback_of&&!latest.config.autoApprove))return;
 await gh.request("/git/refs/heads/main","PATCH",{sha:release.head_sha,force:false});
 await saveRelease(release.id,{status:"deploying",merge_sha:release.head_sha});
}
async function prepareRelease(after:Learning,proposals:any[],severity:"critical"|"minor",validation:Record<string,unknown>,rollbackOf?:string,actor?:string){
 const control=await settings();if(!control.config.enabled||(!rollbackOf&&!control.config.autoApprove))throw Error("Kaya Improve is switched off");
 const gh=new Github(),main=await gh.main(),before=await gh.file(AUTO_POLICY.allowedPath,main.sha),historyText=await gh.file("lib/kaya-improve/history.json",main.sha);
 const current=validateLearning(JSON.parse(before));
 if(!rollbackOf)validation={...validation,...validateCandidate(current,after,await successfulMessages())};
 const content=JSON.stringify(after,null,2)+"\n",id=randomUUID();
 const backup={path:AUTO_POLICY.allowedPath,before,after:content,before_hash:hash(before),after_hash:hash(content)};
 const history=JSON.parse(historyText);history.releases.unshift({id,created_at:new Date().toISOString(),base_commit:main.sha,files:[{path:AUTO_POLICY.allowedPath,status:"modified",before,after:content}]});
 const nextHistoryText=JSON.stringify(history,null,2)+"\n";
 const record={id,status:"preparing",severity,base_sha:main.sha,proposal_ids:proposals.map(p=>p.id),backup,candidate:after,validation:{...validation,passed:true,policy:AUTO_POLICY.version,candidate_hash:hash(content),backup_index_hash:hash(nextHistoryText)},rollback_of:rollbackOf??null,actor:actor??"Kaya Improve"};
 // Durable backup precedes every GitHub mutation.
 const inserted=await improveDb().from("mw_improve_releases").insert(record).select("id").single();if(inserted.error||!inserted.data)throw Error(inserted.error?.message??"Backup failed");
 if(proposals.length){const r=await improveDb().from("mw_improve_proposals").update({release_id:id}).in("id",proposals.map(p=>p.id));if(r.error)throw r.error;}
 try{
  const tree=await gh.request("/git/trees","POST",{base_tree:main.tree,tree:[{path:AUTO_POLICY.allowedPath,mode:"100644",type:"blob",content},{path:"lib/kaya-improve/history.json",mode:"100644",type:"blob",content:nextHistoryText}]});
  const commit=await gh.request("/git/commits","POST",{message:`Kaya Improve ${severity}: validated contact language (${id})`,tree:tree.sha,parents:[main.sha]});
  await gh.request("/git/refs","POST",{ref:`refs/heads/kaya-improve/${id}`,sha:commit.sha});
  const pr=await gh.request("/pulls","POST",{base:"main",head:`kaya-improve/${id}`,title:`Kaya Improve: ${rollbackOf?"restore previous learning":"validated contact-language aliases"}`,body:`Policy: ${AUTO_POLICY.version}. ${severity} release. Exact-language catalog only; business rules cannot be edited. Successful-chat input regression passed. Backup: ${id}. CI and Vercel preview must pass before merge.`});
  await saveRelease(id,{status:"ci_pending",head_sha:commit.sha,pr_number:pr.number});return{id,status:"ci_pending"};
 }catch(e){await saveRelease(id,{status:"blocked",error:e instanceof Error?e.message:String(e)});throw e;}
}
export async function publishReady(){
 const state=await settings();if(!state.config.enabled||!state.config.autoApprove)return;
 const connection=await connectionStatus();if(!connection.ready)return;
 const db=improveDb(),holder=randomUUID();const lease=await db.rpc("kaya_improve_lease",{lease_name:"publisher",holder,release_lease:false});if(lease.error)throw lease.error;if(!lease.data)return;
 try{
  const active=await db.from("mw_improve_releases").select("*").in("status",["preparing","ci_pending","deploying"]).order("created_at");if(active.error)throw active.error;
  for(const release of active.data??[]) {
   if(release.status==="preparing"&&Date.now()-Date.parse(release.created_at)>15*60000)await saveRelease(release.id,{status:"blocked",error:"Preparation was interrupted; inspect this release before retrying."});
   else await progressRelease(release);
  }
  if(active.data?.length)return;
  const pending=await db.from("mw_improve_proposals").select("*").eq("status","approved").is("release_id",null).order("created_at");if(pending.error)throw pending.error;
  const critical=(pending.data??[]).filter(p=>p.severity==="critical");const candidates=critical.length?critical:(pending.data??[]).filter(p=>p.severity==="minor");if(!candidates.length)return;
  const severity=critical.length?"critical":"minor";
  const last=await db.from("mw_improve_releases").select("published_at").eq("severity","minor").eq("status","published").order("published_at",{ascending:false}).limit(1);if(last.error)throw last.error;
  if(!releaseDue(severity,last.data?.[0]?.published_at??null))return;
  const gh=new Github(),main=await gh.main(),before=validateLearning(JSON.parse(await gh.file(AUTO_POLICY.allowedPath,main.sha)));
  const selected=candidates.filter(p=>!before.aliases.some(a=>a.phrase===p.phrase)).slice(0,5);if(!selected.length)return;
  const after=validateLearning({version:1,aliases:[...before.aliases,...selected.map(p=>({phrase:p.phrase,intent:p.intent}))]});
  await prepareRelease(after,selected,severity,{proposal_validations:selected.map(p=>({id:p.id,validation:p.validation}))});
 }finally{await db.rpc("kaya_improve_lease",{lease_name:"publisher",holder,release_lease:true});}
}
export async function rollbackRelease(id:string,actor:string){
 if(!(await connectionStatus()).ready)throw Error("Connect GitHub publishing and its webhook before restoring code");
 const db=improveDb(),holder=randomUUID();const lease=await db.rpc("kaya_improve_lease",{lease_name:"publisher",holder,release_lease:false});if(lease.error||!lease.data)throw Error("Another release is in progress");
 try{
  const active=await db.from("mw_improve_releases").select("id").in("status",["preparing","ci_pending","deploying"]);if(active.error)throw active.error;if(active.data?.length)throw Error("Wait for the current release to finish before restoring");
  const {data,error}=await db.from("mw_improve_releases").select("*").eq("id",id).eq("status","published").single();if(error)throw error;
  if(hash(data.backup.before)!==data.backup.before_hash)throw Error("Backup hash check failed");
  const gh=new Github(),main=await gh.main(),current=await gh.file(AUTO_POLICY.allowedPath,main.sha);
  if(hash(current)!==data.backup.after_hash)throw Error("Only the currently deployed learning version can be restored directly");
  return await prepareRelease(validateLearning(JSON.parse(data.backup.before)),[],"critical",{passed:true,restore_backup_hash:data.backup.before_hash},id,actor);
 }finally{await db.rpc("kaya_improve_lease",{lease_name:"publisher",holder,release_lease:true});}
}

export async function resumeForCommit(sha:string){
 const db=improveDb(),holder=randomUUID();const lease=await db.rpc("kaya_improve_lease",{lease_name:"publisher",holder,release_lease:false});if(lease.error)throw lease.error;if(!lease.data)return false;
 try{const {data,error}=await db.from("mw_improve_releases").select("*").or(`head_sha.eq.${sha},merge_sha.eq.${sha}`).in("status",["ci_pending","deploying"]);if(error)throw error;for(const r of data??[])await progressRelease(r);return !!data?.length;}
 finally{await db.rpc("kaya_improve_lease",{lease_name:"publisher",holder,release_lease:true});}
}

export async function progressRelease(release:any){
 try{return await doProgressRelease(release);}catch(e){await saveRelease(release.id,{status:"blocked",error:e instanceof Error?e.message:String(e)});throw e;}
}
