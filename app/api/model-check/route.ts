import { NextRequest, NextResponse } from "next/server";
import { extractVehicleInfo, generateInquirySummary, getKayaReply, extractAppointment } from "@/lib/claude";
import * as C from "@/lib/claude";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORARY: verifies Haiku 5.5 + caching with the live key. Remove after use.
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("key") !== "23cbb6d336c8439bb033cda5") return NextResponse.json({ error: "no" }, { status: 404 });
  const t = Date.now();
  const car = await extractVehicleInfo("2023 JAC JS4 FULL OPTION DUAL TONE BLACK AND RED");
  const car2 = await extractVehicleInfo("toyata landcrusier 2019 gcc 120k");
  const appt = await extractAppointment("tomorrow at 4pm");
  const hist = [
    { role: "user" as const, content: "Hi" },
    { role: "assistant" as const, content: "Hi! I'm Kaya, the online assistant of Mister Wheelz. May I have your name?" },
    { role: "user" as const, content: "Ali" },
    { role: "assistant" as const, content: "Thanks Ali! What car are you looking to sell? Make, model and year please." },
  ];
  const r1 = await getKayaReply(2, hist, "BMW X5 2020, how much will you give me?", { name: "Ali" });
  const u1 = (C as any).lastKayaUsage;
  const r2 = await getKayaReply(2, hist, "Nissan Patrol 2021", { name: "Ali" });
  const u2 = (C as any).lastKayaUsage;
  const summary = await generateInquirySummary([...hist, { role: "user", content: "BMW X5 2020, how much will you give me?" }, { role: "assistant", content: r1 }], { name: "Ali", make: "BMW", model: "X5", year: "2020" } as any);
  return NextResponse.json({ secs: (Date.now() - t) / 1000, car, car2, appt, r1, u1, r2, u2, summary });
}
