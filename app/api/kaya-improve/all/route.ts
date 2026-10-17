import {NextRequest,NextResponse} from "next/server";
import {timingSafeEqual} from "crypto";
import {waitUntil} from "@vercel/functions";
import {runAllProposalsStep} from "@/lib/kaya-improve/all-proposals";
export const dynamic="force-dynamic";
export const maxDuration=300;
export async function POST(req:NextRequest){
 const secret=process.env.KAYA_IMPROVE_SECRET,actual=req.headers.get("authorization")??"",expected=`Bearer ${secret??""}`;
 if(!secret||Buffer.byteLength(actual)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))return NextResponse.json({error:"Unauthorized"},{status:401});
 if(process.env.VERCEL_ENV!=="production")return NextResponse.json({skipped:true});
 waitUntil(runAllProposalsStep().catch(e=>console.error("[kaya-improve] proposal queue step failed",e)));
 return NextResponse.json({accepted:true},{status:202});
}
