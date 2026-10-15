import type { Chat } from "./detect";
import { improveDb, settings } from "./store";
import { runCheck } from "./runner";
import { RUNS } from "./config";
import { PUBLIC_URL } from "./github";
export async function afterBiginPush(chat:Chat) {
 if(process.env.VERCEL_ENV && process.env.VERCEL_ENV!=="production")return;
 const state=await settings();if(!state.config.enabled)return;
 const db=improveDb();
 for(const run of RUNS) {
  const schedule=state.config.schedules[run.id];if(schedule.mode==="off")continue;
  if(schedule.mode==="interval") {
   const {data,error}=await db.from("mw_improve_runs").select("started_at").eq("kind",run.id).order("started_at",{ascending:false}).limit(1);if(error)throw error;
   if(data?.[0] && Date.now()-Date.parse(data[0].started_at)<schedule.minutes*60000)continue;
  }
  await runCheck(run.id,"bigin",chat.phone,chat);
 }
 if(state.config.autoApprove){
  const response=await fetch(`${PUBLIC_URL}/api/kaya-improve/review`,{method:"POST",headers:{Authorization:`Bearer ${process.env.KAYA_IMPROVE_SECRET}`,"Content-Type":"application/json"},body:JSON.stringify(chat),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error(`Auto-review event was not accepted (${response.status})`);
 }
}

/** Every persisted assistant reply is reviewed, including leads never sent to Bigin. */
export async function afterConversationSave(chat:Chat){
 if(process.env.VERCEL_ENV&&process.env.VERCEL_ENV!=="production")return;
 if(!/^\d{8,16}$/.test(chat.phone)||/^971599900/.test(chat.phone))return;
 const messages=chat.messages??[];if(messages[messages.length-1]?.role!=="assistant")return;
 const state=await settings();if(!state.config.enabled)return;
 const db=improveDb();
 for(const run of RUNS){
  const kind=run.id;if(kind==="confirmation"&&!chat.appointment_date)continue;
  const schedule=state.config.schedules[kind as keyof typeof state.config.schedules];if(schedule.mode==="off")continue;
  if(schedule.mode==="interval"){
   const {data,error}=await db.from("mw_improve_runs").select("started_at").eq("kind",kind).order("started_at",{ascending:false}).limit(1);if(error)throw error;
   if(data?.[0]&&Date.now()-Date.parse(data[0].started_at)<schedule.minutes*60000)continue;
  }
  await runCheck(kind,"conversation",chat.phone,chat);
 }
 if(state.config.autoApprove){
  const r=await fetch(`${PUBLIC_URL}/api/kaya-improve/review`,{method:"POST",headers:{Authorization:`Bearer ${process.env.KAYA_IMPROVE_SECRET}`,"Content-Type":"application/json"},body:JSON.stringify({phone:chat.phone}),signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error(`Conversation review rejected (${r.status})`);
 }
}
