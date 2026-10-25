import { NextResponse } from "next/server";
import { planTurn } from "@/lib/conversation-state";
import { sameQuestion } from "@/lib/conversation-quality";
export const dynamic="force-dynamic";
export function GET(){
  const cases=[
    {name:"urgent seller context",input:"I lost my job and I am going back to India",expected:/sorry to hear|job situation/i},
    {name:"relocation urgency",input:"I'm leaving Dubai soon and need to sell",expected:/leaving the UAE|quick/i},
    {name:"no home inspection",input:"Can you come to my home for inspection?",expected:/Al Quoz/i},
    {name:"price no phone quote",input:"How much will you offer me?",expected:/final offer|inspection/i},
    {name:"non-GCC handoff",input:"American specs",expected:/Mulkiya|engine/i},
    {name:"ordinary lead still collects details",input:"Hi",expected:/name|car/i},
  ];
  const results=cases.map(t=>{
    try{
      const result=planTurn({messages:[]},t.input,{},new Date("2026-10-26T08:00:00Z"));
      return {name:t.name,pass:t.expected.test(result.reply),status:result.state.status,reply:result.reply};
    }catch(e){return{name:t.name,pass:false,error:e instanceof Error?e.message:"unknown"};}
  });
  const state:any={name:"Sam",make:"Toyota",model:"Camry",year:"2021",mileage:"25000",specs:"GCC",loan:"No",sell_timeline:"soon",messages:[]};
  const turns=["I want to sell urgently","I lost my job and need to go to India","Okay","Okay","Okay"];
  const replies:string[]=[];
  for(const input of turns){
    const t=planTurn(state,input,{},new Date("2026-10-25T12:00:00Z"));
    Object.assign(state,t.updates);
    state.messages.push({role:"user",content:input},{role:"assistant",content:t.reply});
    replies.push(t.reply);
  }
  const repeats=replies.slice(1).filter((r,i)=>sameQuestion(r,replies[i])).length;
  const pass=results.every(r=>r.pass)&&repeats===0;
  return NextResponse.json({mode:"SYNTHETIC_READ_ONLY",pass,passed:results.filter(r=>r.pass).length,total:results.length,exact_or_semantic_question_repeats:repeats,results,repetition_case:{inputs:turns,replies},external_messages_sent:0,crm_writes:0},{headers:{"Cache-Control":"no-store"}});
}
