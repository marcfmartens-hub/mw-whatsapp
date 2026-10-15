import {timingSafeEqual} from "crypto";
import {NextRequest,NextResponse} from "next/server";
import {waitUntil} from "@vercel/functions";
import {autoReview} from "@/lib/kaya-improve/approve";
import type {Chat} from "@/lib/kaya-improve/detect";
export const dynamic="force-dynamic";
export const maxDuration=180;
export async function POST(req:NextRequest){
 const secret=process.env.KAYA_IMPROVE_SECRET,expected=`Bearer ${secret??""}`,actual=req.headers.get("authorization")??"";
 if(!secret||Buffer.byteLength(actual)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))return NextResponse.json({error:"Unauthorized"},{status:401});
 if(process.env.VERCEL_ENV&&process.env.VERCEL_ENV!=="production")return NextResponse.json({skipped:"Production only"});
 const raw=await req.text();if(Buffer.byteLength(raw)>1024*1024)return NextResponse.json({error:"Payload too large"},{status:413});
 try{
  const c=JSON.parse(raw);if(!/^\d{8,16}$/.test(c.phone??"")||!Array.isArray(c.messages))return NextResponse.json({error:"Invalid conversation"},{status:400});
  const chat:Chat={phone:c.phone,name:typeof c.name==="string"?c.name:null,step:Number(c.step)||0,appointment_date:c.appointment_date??null,appointment_time:c.appointment_time??null,bigin_pushed_at:c.bigin_pushed_at??null,
   messages:c.messages.slice(-40).filter((m:any)=>["user","assistant"].includes(m.role)&&typeof m.content==="string").map((m:any)=>({role:m.role,content:m.content.slice(0,2000)}))};
  waitUntil(autoReview(chat).catch(e=>console.error("[kaya-improve] auto-review failed",e)));
  return NextResponse.json({accepted:true},{status:202});
 }catch{return NextResponse.json({error:"Invalid payload"},{status:400});}
}
