import { NextRequest,NextResponse } from "next/server";
import { sessionUser } from "@/lib/monitorRole";
import { supabase } from "@/lib/supabase";
import { aiV3Turn } from "@/lib/kaya-v3/ai-engine";
import type { Memory } from "@/lib/kaya-v3/engine";
export const dynamic="force-dynamic";
export const maxDuration=60;
const response=(x:unknown,status=200)=>NextResponse.json(x,{status,headers:{"Cache-Control":"no-store"}});
async function authorized(req:NextRequest){const u=await sessionUser(req);return !!u&&u.role==="super_admin"&&(!req.headers.get("origin")||req.headers.get("origin")===req.nextUrl.origin);}
export async function GET(req:NextRequest){
 if(!await authorized(req))return response({error:"Super Admin required"},401);
 const {data,error}=await supabase.from("mw_whatsapp").select("id,messages,created_at,last_message_at").order("last_message_at",{ascending:false,nullsFirst:false}).limit(200);
 if(error)return response({error:"Unable to read conversations"},500);
 const ids=(data||[]).filter(x=>Array.isArray(x.messages)&&x.messages.length>0).map(x=>x.id);
 return response({ids,count:ids.length,mode:"read-only isolated V3 replay"});
}
export async function POST(req:NextRequest){
 if(!await authorized(req))return response({error:"Super Admin required"},401);
 const body=await req.json().catch(()=>null);
 if(!body||typeof body.id!=="string"||!/^[0-9a-f-]{36}$/i.test(body.id))return response({error:"Invalid conversation id"},400);
 const {data,error}=await supabase.from("mw_whatsapp").select("id,messages").eq("id",body.id).maybeSingle();
 if(error||!data)return response({error:"Conversation unavailable"},404);
 const messages=Array.isArray(data.messages)?data.messages:[];
 const customer=messages.filter((m:any)=>m?.role==="user"&&typeof m.content==="string"&&m.content.trim()).slice(0,40);
 let memory:Memory=body.memory && Array.isArray(body.memory.messages) ? {...body.memory,messages:body.memory.messages.slice(-30)} : {messages:[]};
 const offset=Number.isInteger(body.offset)&&body.offset>=0?Math.min(body.offset,customer.length):0;
 const results:Array<{turn:number;input:string;reply:string;intent:string;violations:string[];reason:string;error?:string}>=[];
 let errors=0,violations=0,repeated=0,pricing=0,hesitation=0,dates=0,specs=0;
 for(let i=offset;i<Math.min(offset+6,customer.length);i++){
  const input=String(customer[i].content).slice(0,2000);
  try{
   const result=await aiV3Turn(memory,input);memory=result.memory;
   const reply=result.reply;
   const issues=[...result.violations];
   if(/\b(?:you(?:'re| are) booked|appointment (?:is|has been) confirmed|i(?:'ve| have) booked)\b/i.test(reply))issues.push("UNVERIFIED_BOOKING");
   if(/\b(?:AED|DHS)\s*\d[\d,]*/i.test(reply))issues.push("PRICE_AMOUNT");
   if(/\b(?:your name|may i (?:know|have) your name)\b/i.test(reply)&&results.some(x=>/\b(?:your name|may i (?:know|have) your name)\b/i.test(x.reply)))issues.push("REPEATED_NAME");
   if(/\b(?:not ready|not now|i.ll call|i will call|let you know|busy)\b/i.test(input)&&/\b(?:book|appointment|what day|what time)\b/i.test(reply))issues.push("PUSH_AFTER_HESITATION");
   if(/\b(?:sunday)\b/i.test(input)&&/\b(?:booked|confirmed)\b/i.test(reply))issues.push("SUNDAY_CONFIRMATION");
   if(issues.includes("REPEATED_NAME"))repeated++;
   violations+=issues.length;
   if(/\b(?:price|how much|estimate|valuation)\b/i.test(input))pricing++;
   if(/\b(?:not ready|not now|i.ll call|i will call|let you know|busy)\b/i.test(input))hesitation++;
   if(/\b(?:tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.test(input))dates++;
   if(/\b(?:gcc|non.gcc|american specs)\b/i.test(input))specs++;
   results.push({turn:i+1,input,reply,intent:result.intent,violations:issues,reason:result.reason});
  }catch(e){errors++;results.push({turn:i+1,input,reply:"",intent:"error",violations:["ENGINE_ERROR"],reason:"",error:e instanceof Error?e.message:"Unknown engine error"});}
 }
 return response({conversation:data.id,totalCustomerTurns:customer.length,processed:results.length,nextOffset:Math.min(offset+6,customer.length),done:offset+6>=customer.length,memory,errors,violations,repeated,pricing,hesitation,dates,specs,results,sideEffects:false,engine:"kaya-v3-ai"});
}
