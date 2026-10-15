import {createHmac,timingSafeEqual} from "crypto";
import {NextRequest,NextResponse} from "next/server";
import {waitUntil} from "@vercel/functions";
import {publishReady,resumeForCommit} from "@/lib/kaya-improve/publisher";
export const dynamic="force-dynamic";
export const maxDuration=300;
export async function POST(req:NextRequest){
 const secret=process.env.KAYA_GITHUB_WEBHOOK_SECRET;if(!secret)return NextResponse.json({error:"Not configured"},{status:503});
 const raw=await req.text();if(Buffer.byteLength(raw)>1024*1024)return NextResponse.json({error:"Payload too large"},{status:413});
 const expected=`sha256=${createHmac("sha256",secret).update(raw).digest("hex")}`,sig=req.headers.get("x-hub-signature-256")??"";
 if(!/^sha256=[a-f0-9]{64}$/.test(sig)||sig.length!==expected.length||!timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return NextResponse.json({error:"Invalid signature"},{status:401});
 if(process.env.VERCEL_ENV&&process.env.VERCEL_ENV!=="production")return NextResponse.json({skipped:"Production only"});
 try{
  const body=JSON.parse(raw);if(body.repository?.full_name!=="marcfmartens-hub/mw-whatsapp")return NextResponse.json({error:"Wrong repository"},{status:403});
  const event=req.headers.get("x-github-event");if(event==="ping")return NextResponse.json({ok:true});
  if(!["check_run","status","deployment_status"].includes(event??""))return NextResponse.json({skipped:true});
  const sha=body.check_run?.head_sha??body.sha??body.deployment?.sha;if(typeof sha!=="string"||!/^[a-f0-9]{40}$/.test(sha))return NextResponse.json({skipped:true});
  waitUntil(resumeForCommit(sha).then(matched=>matched?publishReady():undefined).catch(e=>console.error("[kaya-improve] GitHub completion failed",e)));
  return NextResponse.json({accepted:true},{status:202});
 }catch(e){console.error("[kaya-improve] invalid webhook",e);return NextResponse.json({error:"Invalid payload"},{status:400});}
}
