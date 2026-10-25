import { createBiginContact } from "./bigin";
import { getConversation, updateConversation } from "./supabase";
import type { BiginOutcome } from "./bigin-pipeline";
// Persist pending before attempting external writes, so interruptions remain retryable.
export async function syncBiginOutcome(c:any,outcome:BiginOutcome,reason?:string):Promise<boolean>{
 const state={...(c.flow_state||{})};
 const pending={...(state.biginSync||{}),outcome,pending:true,attemptedAt:new Date().toISOString()};
 await updateConversation(c.phone,{flow_state:{...state,biginSync:pending}} as any);
 const note=[`Kaya — ${outcome==="booked"?"Inspection booked":"CALL BACK"}`,reason||"",`Selling timeline: ${c.sell_timeline||"unknown"}`,`Seller asking price: ${state.askingPriceAed||"not provided"}`,(c.messages||[]).slice(-14).map((m:any)=>`${m.role}: ${m.content}`).join("\n")].filter(Boolean).join("\n\n");
 const payload:any={...c,bigin_outcome:outcome,phone_number:c.phone_number||c.phone,inspection_booked:outcome==="booked",clear_appointment:outcome!=="booked",inquiry_summary:note,sales_inquiry:outcome==="booked"?"Not Sure - Need Advise":"Other"};
 const ok=await createBiginContact(payload);
 const fresh=await getConversation(c.phone);const current:any=fresh?.flow_state||state;
 // Do not mark a newer outcome complete with the result of an older request.
 const changed=current.status!==state.status||["make","model","year"].some(k=>(fresh as any)?.[k]!==c[k])||(fresh?.appointment_date||"")!==(c.appointment_date||"")||(fresh?.appointment_time||"")!==(c.appointment_time||"");
 if(ok&&payload.bigin_sync_result&&!changed){
  const syncedAt=new Date().toISOString();
  await updateConversation(c.phone,{bigin_pushed_at:syncedAt,inquiry_summary:note,flow_state:{...current,biginSync:{...payload.bigin_sync_result,outcome,pending:false,syncedAt}}} as any);
  return true;
 }
 await updateConversation(c.phone,{flow_state:{...current,biginSync:{...pending,pending:true,error:changed?"Newer appointment requires synchronization":"Contact or pipeline write not verified"}}} as any);
 console.error("[Bigin] handoff pending retry",c.phone,outcome);
 return false;
}
