import { NextRequest, NextResponse } from "next/server";
import { sessionUser } from "@/lib/monitorRole";
import { improveDb, settings } from "@/lib/kaya-improve/store";
import { RUNS, validateConfig, nextRun } from "@/lib/kaya-improve/config";
import { runCheck } from "@/lib/kaya-improve/runner";
import { history } from "@/lib/kaya-improve/history";
import { backupZip } from "@/lib/kaya-improve/zip";
export const dynamic="force-dynamic";
export const maxDuration=60;
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
  const version=req.nextUrl.searchParams.get("backup");
  if(version) {
   const release=history.releases.find(r=>r.id===version);
   if(!release) return NextResponse.json({error:"Backup not found"},{status:404});
   return new NextResponse(new Uint8Array(backupZip(release)),{headers:{"Content-Type":"application/zip","Content-Disposition":`attachment; filename="kaya-improve-${release.id}.zip"`,"Cache-Control":"no-store"}});
  }
  const db=improveDb();const state=await settings();
  const [runs,versions,reviews]=await Promise.all([
   db.from("mw_improve_runs").select("*").order("started_at",{ascending:false}).limit(50),
   db.from("mw_improve_versions").select("id,created_at,actor,revision,restored_from").order("created_at",{ascending:false}).limit(50),
   db.from("mw_improve_reviews").select("*").order("reviewed_at",{ascending:false}).limit(100),
  ]);
  for(const result of [runs,versions,reviews]) if(result.error)throw new Error(result.error.message);
  const latest=await Promise.all(RUNS.map(async r=>{
   const {data,error}=await db.from("mw_improve_runs").select("*").eq("kind",r.id).order("started_at",{ascending:false}).limit(1);
   if(error)throw new Error(error.message);return [r.id,data?.[0]??null] as const;
  }));
  const lastRuns=Object.fromEntries(latest);
  return NextResponse.json({state,runs:runs.data,lastRuns,versions:versions.data,reviews:reviews.data,
   next:Object.fromEntries(RUNS.map(r=>[r.id,nextRun(state.config,r.id,lastRuns[r.id]?.started_at??null)])),
   releases:history.releases.map(({files,...r})=>({...r,files:files.map(f=>({path:f.path,status:f.status}))})),
   publishing:{enabled:false,reason:"Locked rule approval, full Kaya response regression tests and GitHub publishing connection must be completed before automated code changes."}
  },{headers:{"Cache-Control":"no-store"}});
 }catch(e){console.error("[kaya-improve] monitor read failed",e);return NextResponse.json({error:e instanceof Error?e.message:"Unable to load monitor"},{status:503});}
}
export async function POST(req:NextRequest) {
 const g=await guard(req,true);if(g.error)return g.error;
 try {
  const body=await req.json();
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
