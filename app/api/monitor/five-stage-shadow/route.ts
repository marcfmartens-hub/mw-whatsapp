import { NextRequest, NextResponse } from "next/server";
import { sessionUser } from "@/lib/monitorRole";
import { supabase } from "@/lib/supabase";
import { planTurn } from "@/lib/conversation-state";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Message = { role: string; content: string };
type Memory = { facts: Record<string,string>; lastQuestion?: string; repeats: number };
const clean = (s:string) => s.toLowerCase().replace(/\s+/g," ").trim();
const urgent = /lost (?:my |the )?job|leav(?:ing|e) (?:dubai|uae|the country)|going (?:back |to )?(?:india|home)|urgent(?:ly)?|must sell|need to sell (?:today|tomorrow|quickly)/i;
const questions = ["make","model","year","mileage","specs","loan","balance","sell","day","time","exact_time","name","confirm","callback"];
function understand(input:string, previous:string) {
  return { urgent:urgent.test(input), affirmative:/^(yes|yeah|yep|ok|okay|sure|fine|alright)[.! ]*$/i.test(input.trim()), price:/\b(price|offer|how much|valuation)\b/i.test(input), previous };
}
function extract(input:string, memory:Memory) {
  const next={...memory,facts:{...memory.facts}};
  if(urgent.test(input))next.facts.urgent_sale="yes";
  if(/lost (?:my |the )?job/i.test(input))next.facts.reason="lost_job";
  if(/going (?:back |to )?(?:india|home)|leav(?:ing|e) (?:dubai|uae|the country)/i.test(input))next.facts.relocation="yes";
  return next;
}
function decide(input:string, response:string, previous:string, intent:ReturnType<typeof understand>, memory:Memory) {
  const same=!!previous && clean(response)===clean(previous);
  return { same, shouldAcknowledge:intent.urgent && !/sorry|understand|leaving|job|urgent|quick/i.test(response), shouldClarify:intent.affirmative && /\b(what time|which day|what exact arrival time)\b/i.test(response), memory };
}
function respond(input:string, base:string, decision:ReturnType<typeof decide>, intent:ReturnType<typeof understand>) {
  let reply=base;
  if(decision.same) {
    if(intent.affirmative) reply="Thanks. To move forward, could you tell me which day and time works best for a free inspection at our Al Quoz branch?";
    else reply="Thanks for the additional information. To help you arrange a free inspection, what day would suit you?";
  }
  if(decision.shouldAcknowledge) reply="I understand you need to sell your car quickly. We can help with a free inspection at our Al Quoz branch. "+reply;
  if(decision.shouldClarify && !decision.same) reply="Thanks. Just to confirm the appointment details: "+reply;
  return reply;
}
function quality(previous:string, current:string) {
  return { exactRepeat:!!previous && clean(previous)===clean(current), hasBookingClaim:/\b(your (?:inspection|appointment) is confirmed|booking confirmed)\b/i.test(current) };
}
export async function POST(req:NextRequest) {
  const user=await sessionUser(req);
  if(!user || user.role!=="super_admin")return NextResponse.json({error:"Super admin login required"},{status:403});
  const {data,error}=await supabase.from("mw_whatsapp").select("id,created_at,last_message_at,messages").order("last_message_at",{ascending:false}).limit(250);
  if(error)return NextResponse.json({error:"Conversation read failed"},{status:500});
  const chats=(data??[]).filter(c=>Array.isArray(c.messages)&&c.messages.some((m:Message)=>m?.role==="user")).slice(0,100);
  const samples:any[]=[];
  let turns=0, baselineRepeats=0, candidateRepeats=0, changed=0, urgentTurns=0, exceptions=0;
  for(const chat of chats){
    const history:Message[]=[];
    const state:Record<string,any>={};
    let memory:Memory={facts:{},repeats:0};
    let prevBase="",prevCandidate="";
    const examples:any[]=[];
    for(const msg of chat.messages as Message[]){
      if(msg?.role!=="user"||typeof msg.content!=="string")continue;
      turns++;
      try {
        const now=new Date(chat.last_message_at||chat.created_at||Date.now());
        const plan=planTurn({...state,messages:history},msg.content,{},now);
        const intent=understand(msg.content,prevCandidate);
        memory=extract(msg.content,memory);
        const decision=decide(msg.content,plan.reply,prevCandidate,intent,memory);
        const candidate=respond(msg.content,plan.reply,decision,intent);
        const baseQuality=quality(prevBase,plan.reply), candidateQuality=quality(prevCandidate,candidate);
        if(baseQuality.exactRepeat)baselineRepeats++;
        if(candidateQuality.exactRepeat)candidateRepeats++;
        if(intent.urgent)urgentTurns++;
        if(candidate!==plan.reply){changed++;if(examples.length<4)examples.push({customer:msg.content,baseline:plan.reply,candidate,reason:decision.same?"repetition":intent.urgent?"urgent context":"clarification"});}
        Object.assign(state,plan.updates);state.flow_state=plan.state;
        history.push({role:"user",content:msg.content},{role:"assistant",content:plan.reply});
        prevBase=plan.reply;prevCandidate=candidate;
      } catch(e){exceptions++;if(examples.length<4)examples.push({error:e instanceof Error?e.message:"unknown"});}
    }
    if(examples.length)samples.push({source_id:chat.id,examples});
  }
  return NextResponse.json({mode:"READ_ONLY_FIVE_STAGE_SHADOW_PROTOTYPE",production_changed:false,external_messages_sent:0,crm_leads_created:0,conversations:chats.length,turns,baseline_exact_repeats:baselineRepeats,candidate_exact_repeats:candidateRepeats,candidate_changed_turns:changed,urgent_customer_turns:urgentTurns,exceptions,examples:samples.slice(0,15),limitations:["Heuristic prototype, not full AI intent understanding","Uses existing planTurn decisions and therefore inherits some flow issues","Exact repetition metric does not measure semantic repetition","Replay timestamp is last_message_at for all turns","No human-labeled correctness or booking conversion evaluation"],notes:"Do not deploy this prototype to the live message handler."},{headers:{"Cache-Control":"no-store"}});
}
