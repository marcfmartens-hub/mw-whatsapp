import { supabase, updateConversation } from "./supabase";
import { syncBiginOutcome } from "./bigin-outcome";
import { inspectionBooked } from "./conversation-state";
export const CALLBACK_AFTER_MINUTES=15;
export function dueBiginOutcome(c:any,now=Date.now()):"booked"|"callback"|null{
 if(!/^\d{8,16}$/.test(c.phone||"")||String(c.phone).startsWith("971599900"))return null;
 if(!(c.messages||[]).some((m:any)=>m.role==="user"))return null;
 const state=c.flow_state||{},sync=state.biginSync;
 const last=Date.parse(c.last_message_at||c.created_at||"");
 const booked=inspectionBooked(c);
 const explicit=state.status==="team_accepted"||state.basicStep==="callback";
 const outcome=booked?"booked":explicit?"callback":null;
 if(!outcome&&(!Number.isFinite(last)||now-last<CALLBACK_AFTER_MINUTES*60000))return null;
 // Respect an explicitly recorded refusal of personal contact.
 if(!outcome&&(state.consent==="declined"||["customer_will_contact","closed"].includes(state.status)))return null;
 if(sync&&!sync.pending&&sync.outcome===(outcome||"callback")&&Date.parse(sync.syncedAt||"")>=last)return null;
 return outcome||"callback";
}
export async function reconcileBigin(){
 const since=new Date(Date.now()-7*86400e3).toISOString();
 const {data,error}=await supabase.from("mw_whatsapp").select("*").gte("last_message_at",since).order("last_message_at",{ascending:false}).limit(500);
 if(error)throw error;
 const due=(data||[]).map(c=>({c,outcome:dueBiginOutcome(c)})).filter(x=>x.outcome)
  .sort((a,b)=>Number(!(a.c.flow_state as any)?.biginSync?.pending)-Number(!(b.c.flow_state as any)?.biginSync?.pending))
  .slice(0,15);
 let pushed=0,failed=0;
 for(const {c,outcome}of due){
  try{
   const state:any=c.flow_state||{};
   const automatic=outcome==="callback"&&state.status!=="team_accepted"&&state.basicStep!=="callback";
   if(automatic){
    c.flow_state={...state,version:1,status:"team_accepted",...(state.basicMode?{basicStep:"done"}:{}),autoCallback:true};
    await updateConversation(c.phone,{flow_state:c.flow_state} as any);
   }
   if(await syncBiginOutcome(c,outcome!,automatic?"No confirmed appointment or callback request; inactive for at least 15 minutes.":"Retry/recovery: verify contact and pipeline handoff."))pushed++;else failed++;
  }catch(e){failed++;console.error("[Bigin] reconciliation failed",c.phone,String(e));}
 }
 console.log(`[Bigin] reconciliation total=${due.length} verified=${pushed} pending=${failed}`);
 return {pushed,total:due.length,failed};
}
