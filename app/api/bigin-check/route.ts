import { NextRequest, NextResponse } from "next/server";
import { getAccessToken } from "@/lib/bigin";

export const dynamic = "force-dynamic";

// TEMPORARY read-only check of Bigin setup (fields, pipelines, org). Remove after use.
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("key") !== "23cbb6d336c8439bb033cda5") return NextResponse.json({ error: "no" }, { status: 404 });
  const tt = req.nextUrl.searchParams.get("tasktest");
  if (tt) {
    const { createChangeTask } = await import("@/lib/bigin");
    return NextResponse.json(await createChangeTask({ phone: tt, phone_number: tt, name: "Sunil", make: "JAC", model: "JS4", year: "2023", mileage: "45000", specs: "GCC", appointment_date: "2026-10-13", appointment_time: "11:00" }, "RESCHEDULE", "TEST — can we do 4pm instead? (delete this task)"));
  }
  const token = await getAccessToken();
  const h = { Authorization: `Zoho-oauthtoken ${token}` };
  const get = async (u: string) => {
    const r = await fetch(u, { headers: h });
    const t = await r.text();
    try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t.slice(0, 500) }; }
  };
  const slim = (x: any) => Array.isArray(x?.body?.fields)
    ? x.body.fields.map((f: any) => `${f.field_label} | ${f.api_name} | ${f.data_type}${f.pick_list_values?.length ? " [" + f.pick_list_values.map((p: any) => p.display_value).join(", ") + "]" : ""}`)
    : x;
  const base = "https://www.zohoapis.com/bigin/v2";
  const [contacts, pipelines, layouts, org] = await Promise.all([
    get(`${base}/settings/fields?module=Contacts`),
    get(`${base}/settings/fields?module=Pipelines`),
    get(`${base}/settings/layouts?module=Pipelines`),
    get(`${base}/org`),
  ]);
  const lay = Array.isArray(layouts.body?.layouts) ? layouts.body.layouts.map((l: any) => ({ name: l.name, id: l.id, sub_pipelines: l.sub_pipelines ?? undefined, stages: (l.sections ?? []).length })) : layouts;
  return NextResponse.json({
    contacts: slim(contacts), pipelines: slim(pipelines), layouts: lay,
    layouts_raw_keys: layouts.body?.layouts?.[0] ? Object.keys(layouts.body.layouts[0]) : null,
    org: org.body?.org?.[0] ? { id: org.body.org[0].id, zgid: org.body.org[0].zgid, domain: org.body.org[0].domain_name } : org,
  });
}
