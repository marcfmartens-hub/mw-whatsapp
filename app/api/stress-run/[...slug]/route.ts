import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { supabase } from "@/lib/supabase";
import { runScenario, BATCH, hookConsole } from "@/app/api/stress-test/route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const fetchCache = "force-no-store";

// TEMPORARY: path-only URLs (no query string) so every result link is a distinct URL.
//   /api/stress-run/<key>/start            → starts the batch in the background
//   /api/stress-run/<key>/res/<job>/<n>    → status or results
const KEY = "23cbb6d336c8439bb033cda5";
const txt = (t: string) => new NextResponse(t, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function GET(req: NextRequest, { params }: { params: { slug: string[] } }) {
  const [key, action, job] = params.slug ?? [];
  if (key !== KEY) return NextResponse.json({ error: "no" }, { status: 404 });

  if (action === "res" && job) {
    const { data } = await supabase.from("mw_whatsapp").select("car_conditions").eq("phone", `stress_${job}`).maybeSingle();
    const out = String(data?.car_conditions ?? "");
    return txt(out ? (out.startsWith("RUNNING") ? `job ${job}: still running` : out) : `job ${job}: not found`);
  }

  if (action === "start") {
    hookConsole();
    const id = Date.now().toString(36);
    const { error } = await supabase.from("mw_whatsapp").insert({ phone: `stress_${id}`, step: 0, car_conditions: "RUNNING" } as any);
    if (error) return txt(`could not create job row: ${error.message}`);
    waitUntil((async () => {
      const outs = await Promise.all(BATCH.map(n => runScenario(n).catch(e => `SCENARIO ${n}: CRASH ${e}`)));
      await supabase.from("mw_whatsapp").update({ car_conditions: outs.join("\n\n==========\n\n") } as any).eq("phone", `stress_${id}`);
    })());
    const base = `${req.nextUrl.origin}/api/stress-run/${KEY}/res/${id}`;
    return txt(`Started job ${id} (${BATCH.length} scenarios). Result links:\n` + Array.from({ length: 15 }, (_, i) => `${base}/${i + 1}`).join("\n"));
  }
  return txt("use /start");
}
