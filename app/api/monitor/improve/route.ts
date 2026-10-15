import { waitUntil } from "@vercel/functions";
import { autoReview } from "@/lib/kaya-improve/approve";
import { detect, Chat } from "@/lib/kaya-improve/detect";
import { NextRequest, NextResponse } from "next/server";
import { sessionUser } from "@/lib/monitorRole";
import { improveDb, settings } from "@/lib/kaya-improve/store";
import { RUNS, validateConfig, nextRun } from "@/lib/kaya-improve/config";
import { runCheck, analyzeRecentChats } from "@/lib/kaya-improve/runner";
import { history } from "@/lib/kaya-improve/history";
import { AUTO_POLICY } from "@/lib/kaya-improve/auto-policy";
import { connectPublisher, connectionStatus, publishReady, rollbackRelease, resumeForCommit, hash } from "@/lib/kaya-improve/publisher";
import { backupZip } from "@/lib/kaya-improve/zip";
export const dynamic="force-dynamic";
export const maxDuration=300;
async function guard(req:NextRequest,write=false) {
 const user=await sessionUser(req);
 if(!user) return {error:NextResponse.json({error:"Unauthorized"},{status:401})};
 if(user.role!=="super_admin") return {error:NextResponse.json({error:"Super Admin only"},{status:403})};
 const origin=req.headers.get("origin");
 if(write && origin && origin!==req.nextUrl.origin) return {error:NextResponse.json({error:"Invalid origin"},{status:403})};
 return {user};
}
export async function GET(req:NextRequest) {
 const g=await guard(req);if(g.error)return g.error;
 try {
  const autoBackup=req.nextUrl.searchParams.get("auto_backup");
  if(autoBackup){
   if(!/^[a-f0-9-]{36}$/.test(autoBackup))return NextResponse.json({error:"Invalid backup"},{status:400});
   const {data,error}=await improveDb().from("mw_improve_releases").select("*").eq("id",autoBackup).single();if(error)throw error;
   if(hash(data.backup.before)!==data.backup.before_hash||hash(data.backup.after)!==data.backup.after_hash)throw Error("Backup integrity check failed");
   const zip=backupZip({id:data.id,files:[{path:AUTO_POLICY.allowedPath,status:"modified",before:data.backup.before,after:data.backup.after}]});
   return new NextResponse(new Uint8Array(zip),{headers:{"Content-Type":"application/zip","Content-Disposition":`attachment; filename="kaya-auto-${data.id}.zip"`,"Cache-Control":"no-store"}});
  }
  const version=req.nextUrl.searchParams.get("backup");
  if(version) {
   const release=history.releases.find(r=>r.id===version);
   if(!release) return NextResponse.json({error:"Backup not found"},{status:404});
   return new NextResponse(new Uint8Array(backupZip(release)),{headers:{"Content-Type":"application/zip","Content-Disposition":`attachment; filename="kaya-improve-${release.id}.zip"`,"Cache-Control":"no-store"}});
  }
  const db=improveDb();const state=await settings();
  const [runs,versions,reviews,proposals,autoReleases]=await Promise.all([
   db.from("mw_improve_runs").select("*").order("started_at",{ascending:false}).limit(50),
   db.from("mw_improve_versions").select("id,created_at,actor,revision,restored_from").order("created_at",{ascending:false}).limit(50),
   db.from("mw_improve_reviews").select("*").order("reviewed_at",{ascending:false}).limit(100),
   db.from("mw_improve_proposals").select("*").order("created_at",{ascending:false}).limit(100),
   db.from("mw_improve_releases").select("id,status,severity,created_at,pr_number,error,published_at,rollback_of,validation").order("created_at",{ascending:false}).limit(50),
  ]);
  for(const result of [runs,versions,reviews,proposals,autoReleases]) if(result.error)throw new Error(result.error.message);
  const latest=await Promise.all(RUNS.map(async r=>{
   const {data,error}=await db.from("mw_improve_runs").select("*").eq("kind",r.id).order("started_at",{ascending:false}).limit(1);
   if(error)throw new Error(error.message);return [r.id,data?.[0]??null] as const;
  }));
  const lastRuns=Object.fromEntries(latest);
  return NextResponse.json({state,proposals:proposals.data,autoReleases:autoReleases.data,autoPolicy:AUTO_POLICY,runs:runs.data,lastRuns,versions:versions.data,reviews:reviews.data,
   next:Object.fromEntries(RUNS.map(r=>[r.id,nextRun(state.config,r.id,lastRuns[r.id]?.started_at??null)])),
   releases:history.releases.map(({files,...r})=>({...r,files:files.map(f=>({path:f.path,status:f.status}))})),
   publishing:{...(await connectionStatus()),enabled:state.config.enabled&&state.config.autoApprove,reason:"Only validated language aliases and approved communication skills can publish after before/after replay. Critical fixes proceed immediately after checks; minor fixes batch at most once per 24 hours. GitHub connection and signed completion webhook are required."}
  },{headers:{"Cache-Control":"no-store"}});
 }catch(e){console.error("[kaya-improve] monitor read failed",e);return NextResponse.json({error:e instanceof Error?e.message:"Unable to load monitor"},{status:503});}
}
export async function POST(req:NextRequest) {
 const g=await guard(req,true);if(g.error)return g.error;
 try {
  const body=await req.json();
  if(body.action==="review_finding") {
   if(process.env.VERCEL_ENV&&process.env.VERCEL_ENV!=="production")return NextResponse.json({error:"Improvement review is production only"},{status:409});
   if(!/^\d{8,16}$/.test(body.phone??"")||!Number.isInteger(body.index)||body.index<0||body.index>100)return NextResponse.json({error:"Invalid finding"},{status:400});
   const state=await settings();if(!state.config.enabled||!state.config.autoApprove)return NextResponse.json({error:"Enable Kaya Improve and automatic approval first"},{status:409});
   const db=improveDb();
   const review=await db.from("mw_improve_reviews").select("findings,reviewed_at").eq("phone",body.phone).single();if(review.error)throw review.error;
   const finding=review.data.findings[body.index];
   if(review.data.reviewed_at!==body.reviewed_at||!finding||finding.code!==body.code)return NextResponse.json({error:"Finding changed; refresh the report"},{status:409});
   const row=await db.from("mw_whatsapp").select("*").eq("phone",body.phone).single();if(row.error)throw row.error;
   const chat=row.data as Chat;
   if(!detect(chat).findings.some(f=>f.code===finding.code&&f.evidence===finding.evidence))return NextResponse.json({error:"Conversation changed; analyze it again first"},{status:409});
   waitUntil(autoReview(chat,finding.code).catch(e=>console.error("[kaya-improve] finding review failed",e)));
   return NextResponse.json({ok:true,message:"Review requested. Follow its progress in Run history and Improvement proposals. Passing supported fixes follow the existing release protocol; unsupported fixes require Super Admin review."},{status:202});
  }
  if(body.action==="analyze_recent")return NextResponse.json({ok:true,result:await analyzeRecentChats(body.count)});
  if(body.action==="connect_publishing")return NextResponse.json(await connectPublisher());
  if(body.action==="refresh_releases"){
   if(!(await connectionStatus()).ready)return NextResponse.json({error:"GitHub publishing connection is not ready"},{status:409});
   const {data,error}=await improveDb().from("mw_improve_releases").select("head_sha,merge_sha").in("status",["ci_pending","deploying"]);if(error)throw error;
   for(const r of data??[])await resumeForCommit(r.merge_sha??r.head_sha);
   return NextResponse.json({ok:true});
  }
  if(body.action==="publish_ready"){
   const connection=await connectionStatus();if(!connection.ready)return NextResponse.json({error:"GitHub publishing connection is not ready"},{status:409});
   const state=await settings();if(!state.config.enabled||!state.config.autoApprove)return NextResponse.json({error:"Enable detection and auto approval first"},{status:409});
   await publishReady();return NextResponse.json({ok:true});
  }
  if(body.action==="rollback_code"){
   if(!/^[a-f0-9-]{36}$/.test(body.release??""))return NextResponse.json({error:"Invalid release"},{status:400});
   return NextResponse.json({ok:true,result:await rollbackRelease(body.release,g.user!.username)});
  }
  if(body.action==="reject_proposal"){
   if(!/^[a-f0-9]{64}$/.test(body.proposal??""))return NextResponse.json({error:"Invalid proposal"},{status:400});
   const r=await improveDb().from("mw_improve_proposals").update({status:"rejected",updated_at:new Date().toISOString()}).eq("id",body.proposal).is("release_id",null).in("status",["approved","needs_admin"]);if(r.error)throw r.error;
   return NextResponse.json({ok:true});
  }
  if(body.action==="run") {
   const kind=RUNS.find(r=>r.id===body.kind)?.id;if(!kind)return NextResponse.json({error:"Invalid run type"},{status:400});
   const state=await settings();if(!state.config.enabled || state.config.schedules[kind].mode==="off")return NextResponse.json({error:"Enable the system and this run first"},{status:409});
   return NextResponse.json({ok:true,result:await runCheck(kind,"manual")});
  }
  if(!Number.isInteger(body.revision))return NextResponse.json({error:"Revision required"},{status:400});
  const restore=body.action==="restore";
  if(restore && !/^[0-9a-f-]{36}$/.test(body.version??""))return NextResponse.json({error:"Invalid restore point"},{status:400});
  const config=restore?null:validateConfig(body.config);
  const {data,error}=await improveDb().rpc("kaya_improve_save",{expected_revision:body.revision,next_config:config,actor_name:g.user!.username,restore_version:restore?body.version:null});
  if(error)throw new Error(error.message);
  return NextResponse.json({ok:true,revision:data});
 }catch(e){console.error("[kaya-improve] monitor action failed",e);return NextResponse.json({error:e instanceof Error?e.message:"Action failed"},{status:400});}
}
