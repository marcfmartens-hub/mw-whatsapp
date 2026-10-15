import type { Chat } from "./detect";
import { improveDb, settings } from "./store";
import { runCheck } from "./runner";
import { RUNS } from "./config";
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
}
