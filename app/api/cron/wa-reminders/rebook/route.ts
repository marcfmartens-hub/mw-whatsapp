import { NextRequest } from "next/server";
import { runWaReminders } from "@/lib/waReminders";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(req: NextRequest) { return runWaReminders(req, "rebook"); }
