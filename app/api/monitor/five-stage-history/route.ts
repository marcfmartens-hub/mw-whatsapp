import { NextRequest, NextResponse } from "next/server";
import { sessionUser } from "@/lib/monitorRole";
import { supabase } from "@/lib/supabase";
import { planTurn } from "@/lib/conversation-state";
import { sameQuestion } from "@/lib/conversation-quality";
export const dynamic="force-dynamic";
export const maxDuration=60;
type Msg={role:string;content:string};
const normalize=(s:string)=>s.toLowerCase().replace(/\s+/g," ").trim();
function repeated(replies:string[]){let adjacent=0,windowed=0;for(let i=1;i<replies.length;i++){if(normalize(replies[i])===normalize(replies[i-1]))adjacent++;if(replies.slice(Math.max(0,i-6),i).some(x=>sameQuestion(x,replies[i])))windowed++;}return {adjacent,windowed};}
function replay(c:any){
 const state:Record<string,any>={};const history:Msg[]=[];const replies:string[]=[];let errors=0,bookingClaims=0,bookingActions=0;
 for(const m of c.messages as Msg[]){
  if(m?.role!=="user"||typeof m.content!=="string")continue;
  try {
   const turn=planTurn({...state,messages:history},m.content,{},new Date(c.last_message_at||c.created_at||Date.now()));
   Object.assign(state,turn.updates);state.flow_state=turn.state;
   history.push({role:"user",content:m.content},{role:"assistant",content:turn.reply});replies.push(turn.reply);
   if(/you'?re booked for|booking confirmed/i.test(turn.reply))bookingClaims++;
   if(turn.crm==="booking")bookingActions++;
  }catch{errors++;}
 }
 return {...repeated(replies),errors,bookingClaims,bookingActions,turns:replies.length};
}
export async function POST(req:NextRequest){
 const user=await sessionUser(req);
 if(!user||user.role!=="super_admin")return NextResponse.json({error:"Super admin login required"},{status:403});
 const {data,error}=await supabase.from("mw_whatsapp").select("id,created_at,last_message_at,messages").order("last_message_at",{ascending:false}).limit(250);
 if(error)return NextResponse.json({error:"Read failed"},{status:500});
 const chats=(data??[]).filter((c:any)=>Array.isArray(c.messages)&&c.messages.some((m:Msg)=>m?.role==="user")&&!c.messages.some((m:Msg)=>String(m?.content??"").includes("Kaya Stress Test"))).slice(0,100);
 const totals={conversations:chats.length,customer_turns:0,original_historical_adjacent_repeats:0,original_historical_window_repeats:0,new_engine_adjacent_repeats:0,new_engine_window_repeats:0,exceptions:0,booking_claims:0,booking_actions:0};
 const problematic:any[]=[];
 for(const c of chats){
  const original=(c.messages as Msg[]).filter(m=>m?.role==="assistant"&&typeof m.content==="string").map(m=>m.content);
  const base=repeated(original), next=replay(c);
  totals.customer_turns+=next.turns;totals.original_historical_adjacent_repeats+=base.adjacent;totals.original_historical_window_repeats+=base.windowed;totals.new_engine_adjacent_repeats+=next.adjacent;totals.new_engine_window_repeats+=next.windowed;totals.exceptions+=next.errors;totals.booking_claims+=next.bookingClaims;totals.booking_actions+=next.bookingActions;
  if(next.windowed||next.errors)problematic.push({conversation_id:c.id,turns:next.turns,repeat_count:next.windowed,errors:next.errors});
 }
 return NextResponse.json({mode:"AUTHENTICATED_HISTORICAL_SHADOW_REPLAY",production_changed:false,whatsapp_messages_sent:0,crm_writes:0,totals,problematic:problematic.slice(0,30),limitations:["Historical replies compared to new simulated replies, not identical baseline replay","Replay uses last_message_at for every turn","Repetition comparison is heuristic and not a human quality score","No actual conversion rate inferred"]},{headers:{"Cache-Control":"no-store"}});
}
