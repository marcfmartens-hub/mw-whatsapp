import {supabase} from "./supabase";
import {syncConsoleLead} from "./console-crm";
import {toIsoDate,toTime24} from "./bigin";
export async function reconcileConsole(){
 const since=new Date(Date.now()-7*86400e3).toISOString();
 const {data,error}=await supabase.from("mw_whatsapp").select("*").gte("last_message_at",since).order("last_message_at",{ascending:false}).limit(500);
 if(error)throw error;
 const candidates=(data||[]).filter((c:any)=>{
  if(!/^\d{8,16}$/.test(c.phone||"")||String(c.phone).startsWith("971599900"))return false;
  const sync=c.flow_state?.consoleSync;
  if(sync?.pending)return !(Date.parse(sync.runningUntil||"")>Date.now());
  return !sync&&Boolean(c.bigin_pushed_at)&&(c.messages||[]).some((m:any)=>m.role==="user");
 }).slice(0,15);
 let synced=0,failed=0;
 for(const c of candidates){
  const state:any=c.flow_state||{},booked=state.biginSync?.outcome==="booked"||state.status==="booked";
  const payload={...c,inspection_booked:booked,clear_appointment:!booked,appointment_date:toIsoDate(String(c.appointment_date||"")),appointment_time:toTime24(String(c.appointment_time||""))};
  if(await syncConsoleLead(payload,state.consoleSync?.pending?state.consoleSync.payload:undefined))synced++;else failed++;
 }
 return {total:candidates.length,synced,failed};
}

