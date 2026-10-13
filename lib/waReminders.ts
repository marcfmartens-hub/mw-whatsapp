import { NextRequest, NextResponse } from "next/server";
import { getAccessToken } from "@/lib/bigin";


// WA Appointments reminders (Marc, 13 Oct 2026)
//  • 6 PM–11 PM Dubai, hourly: Booked Appointments with an appointment TOMORROW → Ready for WA Confirmation
//    (the hourly repeats catch cards the call centre confirms after 6 PM)
//  • 11:55 PM Dubai: Ready for WA Confirmation with "Followed up Today" ticked → Reminder Sent, tick removed
const BOOKED = "Booked Appointments";
const READY = "Ready for WA Confirmation";
const SENT = "Reminder Sent";

async function stageDeals(stage: string, headers: Record<string, string>): Promise<any[]> {
  const out: any[] = [];
  for (let page = 1; page <= 10; page++) {
    const crit = encodeURIComponent(`(Stage:equals:${stage})`);
    const r = await fetch(`https://www.zohoapis.com/bigin/v1/Pipelines/search?criteria=${crit}&page=${page}&per_page=200`, { headers, cache: "no-store" });
    if (r.status === 204) break;
    const j = await r.json().catch(() => ({}));
    out.push(...(j.data ?? []));
    if (!j.info?.more_records) break;
  }
  return out;
}

async function update(rows: Record<string, unknown>[], headers: Record<string, string>) {
  const results: any[] = [];
  for (let i = 0; i < rows.length; i += 100) {
    const r = await fetch("https://www.zohoapis.com/bigin/v1/Pipelines", { method: "PUT", headers, body: JSON.stringify({ data: rows.slice(i, i + 100) }) });
    const j = await r.json().catch(() => ({}));
    results.push(...(j.data ?? [{ status: "error", http: r.status }]));
  }
  return results;
}

export async function runWaReminders(req: NextRequest, job: "evening" | "night") {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = await getAccessToken();
  const headers = { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" };
  const now = new Date(Date.now() + 4 * 3600e3);
  const tomorrow = new Date(now.getTime() + 86400e3).toISOString().slice(0, 10);

  if (job === "evening") {
    const deals = await stageDeals(BOOKED, headers);
    // "2026-10-14T18:00:00+04:00" → Dubai date is the first 10 characters
    const due = deals.filter(d => String(d.Appointment_Date_and_Time ?? "").slice(0, 10) === tomorrow);
    const res = due.length ? await update(due.map(d => ({ id: d.id, Stage: READY })), headers) : [];
    console.log(`[wa-reminders] evening: ${due.length} → ${READY}`, JSON.stringify(res.map(r => r.status)));
    return NextResponse.json({ job, tomorrow, moved: due.map(d => d.Deal_Name), results: res.map(r => r.status) });
  }

  if (job === "night") {
    const deals = await stageDeals(READY, headers);
    const ticked = deals.filter(d => d.Followed_up_Today === true);
    const res = ticked.length ? await update(ticked.map(d => ({ id: d.id, Stage: SENT, Followed_up_Today: false })), headers) : [];
    console.log(`[wa-reminders] night: ${ticked.length} → ${SENT}`, JSON.stringify(res.map(r => r.status)));
    return NextResponse.json({ job, moved: ticked.map(d => d.Deal_Name), results: res.map(r => r.status) });
  }

  return NextResponse.json({ error: "job must be evening or night" }, { status: 400 });
}
