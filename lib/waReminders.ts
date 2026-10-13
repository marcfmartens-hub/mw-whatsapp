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

export async function runWaReminders(req: NextRequest, job: "evening" | "night" | "rebook") {
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
    const today = now.toISOString().slice(0, 10);
    const ready = await stageDeals(READY, headers);
    const ticked = ready.filter(d => d.Followed_up_Today === true && String(d.Appointment_Date_and_Time ?? "").slice(0, 10) > today);
    const res = ticked.length ? await update(ticked.map(d => ({ id: d.id, Stage: SENT, Followed_up_Today: false })), headers) : [];
    console.log(`[wa-reminders] night: ${ticked.length} → ${SENT}`, JSON.stringify(res.map(r => r.status)));

    // No-shows (Marc, 13 Oct): everything left in Confirmed Today / Not Confirmed Today / No-show | WA, plus any
    // other appointment card whose day has passed → WA Follow-ups / Day 1 with the NO SHOW tag
    const noShow: any[] = [];
    for (const st of ["Confirmed Today", "Not Confirmed Today", "No-show | WA"]) noShow.push(...await stageDeals(st, headers));
    for (const st of [BOOKED, READY, SENT]) {
      const list = await stageDeals(st, headers);
      noShow.push(...list.filter(d => { const day = String(d.Appointment_Date_and_Time ?? "").slice(0, 10); return day && day <= today; }));
    }
    const ns = noShow.length ? await update(noShow.map(d => ({ id: d.id, Sub_Pipeline: "WA Follow-ups", Stage: "Day 1", Followed_up_Today: false })), headers) : [];
    for (const d of noShow) {
      await fetch(`https://www.zohoapis.com/bigin/v1/Pipelines/${d.id}/actions/add_tags?tag_names=${encodeURIComponent("NO SHOW")}&over_write=false`, { method: "POST", headers })
        .catch(e => console.warn("[wa-reminders] tag error:", e));
    }
    console.log(`[wa-reminders] night: ${noShow.length} no-shows → WA Follow-ups / Day 1`, JSON.stringify(ns.map(r => r.status)));

    // No Response (Marc, 13 Oct): WhatsApp Standard / No Response → WA Follow-ups with a tag:
    //  • Next Follow up Date filled → Call Later + CALL LATER tag
    //  • otherwise                  → Day 1 + NO RESPONSE tag
    const noResp = (await stageDeals("No Response", headers)).filter(d => !d.Sub_Pipeline || d.Sub_Pipeline === "WhatsApp Standard");
    const nr = noResp.length ? await update(noResp.map(d => ({ id: d.id, Sub_Pipeline: "WA Follow-ups", Stage: d.Next_Follow_up_Date ? "Call Later" : "Day 1", Followed_up_Today: false })), headers) : [];
    for (const d of noResp) {
      const tag = d.Next_Follow_up_Date ? "CALL LATER" : "NO RESPONSE";
      await fetch(`https://www.zohoapis.com/bigin/v1/Pipelines/${d.id}/actions/add_tags?tag_names=${encodeURIComponent(tag)}&over_write=false`, { method: "POST", headers })
        .catch(e => console.warn("[wa-reminders] tag error:", e));
    }
    // A follow-up card that got a date later (Call Later) → CALL LATER tag instead of NO RESPONSE
    for (const d of await stageDeals("Call Later", headers)) {
      const tags = (d.Tag ?? []).map((t: any) => t.name);
      if (d.Next_Follow_up_Date && !tags.includes("CALL LATER")) {
        await fetch(`https://www.zohoapis.com/bigin/v1/Pipelines/${d.id}/actions/add_tags?tag_names=${encodeURIComponent("CALL LATER")}&over_write=false`, { method: "POST", headers }).catch(() => {});
        if (tags.includes("NO RESPONSE")) await fetch(`https://www.zohoapis.com/bigin/v1/Pipelines/${d.id}/actions/remove_tags?tag_names=${encodeURIComponent("NO RESPONSE")}`, { method: "POST", headers }).catch(() => {});
      }
    }
    console.log(`[wa-reminders] night: ${noResp.length} no response → WA Follow-ups / Day 1`, JSON.stringify(nr.map(r => r.status)));
    return NextResponse.json({ job, reminderSent: ticked.map(d => d.Deal_Name), noShows: noShow.map(d => d.Deal_Name), noResponse: noResp.map(d => d.Deal_Name), results: [...res, ...ns, ...nr].map(r => r.status) });
  }

  // Rebooked from follow-up (Marc, 13 Oct): Booked | Follow-ups → back to the booking flow, NO SHOW tag removed.
  // Sent through WhatsApp Standard / Booking Confirmed so the existing Bigin workflow creates the calendar
  // event and moves the card to WA Appointments / Booked Appointments. Needs Appointment Date and Time.
  if (job === "rebook") {
    const deals = await stageDeals("Booked | Follow-ups", headers);
    const ready = deals.filter(d => d.Appointment_Date_and_Time);
    const waiting = deals.filter(d => !d.Appointment_Date_and_Time).map(d => d.Deal_Name);
    const results: any[] = [];
    for (const d of ready) {
      await fetch(`https://www.zohoapis.com/bigin/v1/Pipelines/${d.id}/actions/remove_tags?tag_names=${encodeURIComponent("NO SHOW,NO RESPONSE,CALL LATER")}`, { method: "POST", headers })
        .catch(e => console.warn("[wa-reminders] untag error:", e));
      const r = await fetch("https://www.zohoapis.com/bigin/v1/Pipelines", {
        method: "PUT", headers,
        body: JSON.stringify({ data: [{ id: d.id, Sub_Pipeline: "WhatsApp Standard", Stage: "Booking Confirmed", Followed_up_Today: false }], trigger: ["workflow"] }),
      });
      const j = await r.json().catch(() => ({}));
      results.push(j.data?.[0]?.status ?? `http ${r.status}`);
    }
    console.log(`[wa-reminders] rebook: ${ready.length} → Booking Confirmed (workflow → Booked Appointments); waiting for a date: ${waiting.length}`, JSON.stringify(results));
    return NextResponse.json({ job, rebooked: ready.map(d => d.Deal_Name), waitingForDate: waiting, results });
  }

  return NextResponse.json({ error: "job must be evening, night or rebook" }, { status: 400 });
}
