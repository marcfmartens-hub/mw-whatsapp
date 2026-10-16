import {NextResponse} from "next/server";
import learning from "@/lib/kaya-improve/learning.json";
import {createHash} from "crypto";
export const dynamic="force-dynamic";
export function GET(){return NextResponse.json({repository:"marcfmartens-hub/mw-whatsapp",learningHash:createHash("sha256").update(JSON.stringify(learning,null,2)+"\n").digest("hex"),environment:process.env.VERCEL_ENV??null,commit:process.env.VERCEL_GIT_COMMIT_SHA??null},{headers:{"Cache-Control":"no-store"}});}
