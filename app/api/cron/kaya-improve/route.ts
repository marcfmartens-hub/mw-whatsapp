import {queueAllProposals,runAllProposalsStep} from "@/lib/kaya-improve/all-proposals";
import {processPendingReviews} from "@/lib/kaya-improve/pending";
import {NextRequest,NextResponse} from "next/server";
import {timingSafeEqual} from "crypto";
import {publishReady} from "@/lib/kaya-improve/publisher";
import {autoReview} from "@/lib/kaya-improve/approve";
import {improveDb,settings} from "@/lib/kaya-improve/store";
export const dynamic="force-dynamic";
export const maxDuration=300;
export async function GET(req:NextRequest){
 const secret=process.env.CRON_SECRET,actual=req.headers.get("authorization")??"",expected=`Bearer ${secret??""}`;
 if(!secret||Buffer.byteLength(actual)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))return NextResponse.json({error:"Unauthorized"},{status:401});
 if(process.env.VERCEL_ENV!=="production")return NextResponse.json({skipped:true});
 const state=await settings();if(!state.config.enabled)return NextResponse.json({skipped:true});
 await publishReady();
 if(!state.config.autoApprove)return NextResponse.json({publishing:false});
 if(state.config.fullAutonomous)await queueAllProposals("Kaya autonomous",true);
 const all=await runAllProposalsStep();
 if(!("idle" in all)&&!("paused" in all))return NextResponse.json({all});
 const pending=await processPendingReviews();
 if(!("idle" in pending))return NextResponse.json({pending});
 const {data,error}=await improveDb().from("mw_whatsapp").select("*").order("last_message_at",{ascending:false}).limit(5);if(error)throw error;
 let reviewed=0;const errors:string[]=[];
 for(const chat of data??[]){if(!/^\d{8,16}$/.test(chat.phone)||/^971599900/.test(chat.phone))continue;try{await autoReview(chat);reviewed++;}catch{errors.push("Review deferred; inspect run history");}}
 return NextResponse.json({reviewed,errors});
}
