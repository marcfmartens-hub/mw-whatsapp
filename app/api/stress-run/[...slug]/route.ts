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

  // Every result link can be used once (the fetch tool caches by URL), so each link does the next step:
  // no run / last result already read → start a new run · running → status · finished → show (once)
  if (action === "res" && job) {
    const ROW = "stress_latest";
    const { data } = await supabase.from("mw_whatsapp").select("car_conditions, step, last_msg_id").eq("phone", ROW).maybeSingle();
    let state = data ? Number(data.step) : -1; // 0 running · 1 done unread · 2 read
    // A run that got cut off (function time limit) still shows what finished
    if (state === 0 && Date.now() - Number(data?.last_msg_id ?? 0) > 6 * 60e3) state = 1;
    if (state === 0) return txt("still running — try the next link in a minute");
    if (state === 1) {
      await supabase.from("mw_whatsapp").update({ step: 2 } as any).eq("phone", ROW);
      return txt(String(data!.car_conditions ?? "").replace(/^RUNNING\n?/, ""));
    }
    hookConsole();
    const start = { step: 0, car_conditions: "RUNNING", last_msg_id: String(Date.now()) };
    if (data) await supabase.from("mw_whatsapp").update(start as any).eq("phone", ROW);
    else await supabase.from("mw_whatsapp").insert({ phone: ROW, ...start } as any);
    waitUntil((async () => {
      const done: string[] = [];
      await Promise.all(BATCH.map(async n => {
        const out = await runScenario(n).catch(e => `SCENARIO ${n}: CRASH ${e}`);
        done.push(out);
        await supabase.from("mw_whatsapp").update({ car_conditions: "RUNNING\n" + done.join("\n\n==========\n\n") } as any).eq("phone", ROW);
      }));
      await supabase.from("mw_whatsapp").update({ step: 1, car_conditions: done.join("\n\n==========\n\n") } as any).eq("phone", ROW);
    })());
    const n0 = Number(params.slug?.[3] ?? 0);
    const more = Array.from({ length: 25 }, (_, i) => `${req.nextUrl.origin}/api/stress-run/${KEY}/res/${job}/${n0 + 1 + i}`).join("\n");
    return txt(`started a new run (${BATCH.length} scenarios) — results on the next link in ~4 minutes\nNext links:\n${more}`);
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
