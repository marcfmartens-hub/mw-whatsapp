import {createHmac} from "node:crypto";
import {getConversation,updateConversation} from "./supabase";
import {consolePayload} from "./console-crm-payload";
export async function syncConsoleLead(conversation:any,retryPayload?:any):Promise<boolean>{
 const phone=String(conversation.phone||conversation.phone_number||"");
 const sim=(globalThis as any).__kayaSim?.get(phone);
 if(sim){sim.push("[CONSOLE CRM] contact + vehicle handoff");return true;}
 const payload=retryPayload||consolePayload(conversation);
 try{
  let latest=await getConversation(phone);if(!latest)return false;
  const previous=(latest.flow_state as any)?.consoleSync||{};
  if(previous.eventId===payload.eventId&&!previous.pending)return true;
  await updateConversation(phone,{flow_state:{...(latest.flow_state||{}),consoleSync:{...previous,pending:true,payload,eventId:payload.eventId,attemptedAt:new Date().toISOString(),runningUntil:new Date(Date.now()+60000).toISOString()}}} as any);
  const secret=process.env.KAYA_CRM_SYNC_SECRET,url=process.env.CONSOLE_CRM_URL;
  if(!secret||secret.length<32||!url)throw Error("not_configured");
  const endpoint=new URL("/api/kaya/leads",url);if(endpoint.protocol!=="https:")throw Error("invalid_endpoint");
  const timestamp=String(Date.now()),body=JSON.stringify(payload),signature=createHmac("sha256",secret).update(timestamp+"\n"+body).digest("hex");
  const response=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json","x-kaya-timestamp":timestamp,"x-kaya-signature":signature},body,cache:"no-store",signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw Error("HTTP_"+response.status);
  const result=await response.json();if(!result.contactId||!result.leadId)throw Error("invalid_acknowledgement");
  latest=await getConversation(phone);const current:any=latest?.flow_state||{};
  if(current.consoleSync?.eventId===payload.eventId)await updateConversation(phone,{flow_state:{...current,consoleSync:{eventId:payload.eventId,pending:false,contactId:result.contactId,leadId:result.leadId,syncedAt:new Date().toISOString()}}} as any);
  console.log("[Console CRM] handoff verified");
  return true;
 }catch(error){
  const latest=await getConversation(phone).catch(()=>null),current:any=latest?.flow_state||{};
  if(current.consoleSync?.eventId===payload.eventId)await updateConversation(phone,{flow_state:{...current,consoleSync:{...current.consoleSync,pending:true,runningUntil:null,error:error instanceof Error&&/^(not_configured|invalid_endpoint|invalid_acknowledgement|HTTP_\d+)$/.test(error.message)?error.message:"delivery_failed"}}} as any).catch(()=>{});
  console.error("[Console CRM] handoff pending retry");
  return false;
 }
}

