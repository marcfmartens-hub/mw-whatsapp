import { supabase } from "@/lib/supabase";
import { getAccessToken, toTime24 } from "@/lib/bigin";

// Default time when the customer gives a day but no time (Marc): 12:15 PM, unless something is
// already booked twice around then — then 1:15, 2:15 … PM. Checks Kaya's own bookings (Supabase) and
// Bigin (contact appointments + calendar events).

const OPEN: Record<number, number | null> = { 0: null, 1: 10, 2: 10, 3: 10, 4: 10, 5: 12, 6: 10 };
const CANDIDATES = ["12:15", "13:15", "14:15", "15:15", "16:15", "17:15", "11:15", "10:15"];
const toMin = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5);

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]).catch(() => fallback);
}

async function supabaseTimes(isoDate: string, excludePhone?: string): Promise<string[]> {
  const { data } = await supabase
    .from("mw_whatsapp")
    .select("phone, appointment_time")
    .eq("appointment_date", isoDate);
  return (data ?? [])
    .filter((r: any) => r.phone !== excludePhone && r.appointment_time)
    .map((r: any) => toTime24(String(r.appointment_time)))
    .filter(Boolean) as string[];
}

// "2026-10-17T13:15:00+04:00" → "13:15" (Dubai)
function dubaiHHMM(dt: string): string | null {
  const d = new Date(dt);
  if (isNaN(d.getTime())) return null;
  const x = new Date(d.getTime() + 4 * 3600e3);
  return `${String(x.getUTCHours()).padStart(2, "0")}:${String(x.getUTCMinutes()).padStart(2, "0")}`;
}

async function biginTimes(isoDate: string): Promise<{ contacts: string[]; events: string[] }> {
  const out = { contacts: [] as string[], events: [] as string[] };
  try {
    const token = await getAccessToken();
    const headers = { Authorization: `Zoho-oauthtoken ${token}` };
    const next = new Date(Date.parse(`${isoDate}T00:00:00Z`) + 86400e3).toISOString().slice(0, 10);
    const [contacts, events] = await Promise.all([
      fetch(`https://www.zohoapis.com/bigin/v1/Contacts/search?criteria=${encodeURIComponent(`(Appointment_Date:equals:${isoDate})`)}`, { headers, cache: "no-store" })
        .then((r) => (r.status === 200 ? r.json() : { data: [] })).catch(() => ({ data: [] })),
      fetch(`https://www.zohoapis.com/bigin/v1/Events/search?criteria=${encodeURIComponent(`((Start_DateTime:greater_equal:${isoDate}T00:00:00+04:00)and(Start_DateTime:less_than:${next}T00:00:00+04:00))`)}`, { headers, cache: "no-store" })
        .then((r) => (r.status === 200 ? r.json() : { data: [] })).catch(() => ({ data: [] })),
    ]);
    for (const c of contacts?.data ?? []) {
      const t = c.Appointment_Date_and_Time ? dubaiHHMM(c.Appointment_Date_and_Time) : c.Appointment_Time ? toTime24(String(c.Appointment_Time)) : null;
      if (t) out.contacts.push(t);
    }
    for (const e of events?.data ?? []) {
      const t = e.Start_DateTime ? dubaiHHMM(e.Start_DateTime) : null;
      if (t) out.events.push(t);
    }
  } catch (e) {
    console.warn("[slots] Bigin check failed (using Supabase only):", e);
  }
  return out;
}

const PART: Record<string, string[]> = {
  morning:   ["10:15", "11:15", "12:15"],
  afternoon: ["14:15", "15:15", "13:15", "16:15"],
  evening:   ["17:15", "18:15", "16:15"],
};

export async function pickDefaultTime(isoDate: string, excludePhone?: string, part?: "morning" | "afternoon" | "evening"): Promise<string> {
  const day = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
  if (day === 0) throw new Error("No inspection slots on Sunday");
  const open = OPEN[day] ?? 10;
  const nowDubai = new Date(Date.now() + 4 * 3600e3);
  const isToday = nowDubai.toISOString().slice(0, 10) === isoDate;
  const nowMin = nowDubai.getUTCHours() * 60 + nowDubai.getUTCMinutes();

  const [a, b] = await Promise.all([
    withTimeout(supabaseTimes(isoDate, excludePhone), 4000, [] as string[]),
    withTimeout(biginTimes(isoDate), 5000, { contacts: [] as string[], events: [] as string[] }),
  ]);

  // Max 2 bookings per slot (Marc). Kaya's bookings are also in Bigin, so the sources overlap:
  // per slot take the highest count of any one source rather than adding them up.
  const SLOT_CAPACITY = 2;
  // The :15 slots are Kaya's own (the call center books :00 / :30), so only exact :15 bookings count
  const near = (list: string[], c: string) => list.filter((t) => toMin(t) === toMin(c)).length;
  const booked = (c: string) => Math.max(near(a, c), near(b.contacts, c), near(b.events, c));

  const valid = (part ? PART[part] : CANDIDATES).filter((c) => toMin(c) >= open * 60 && (!isToday || toMin(c) >= nowMin + 60));
  const free = valid.find((c) => booked(c) < SLOT_CAPACITY);
  if (!free) throw new Error("No available default slot in the requested window");
  const pick = free;
  console.log(`[slots] ${isoDate}: supabase=[${a.join(",")}] bigin=[${b.contacts.join(",")}] events=[${b.events.join(",")}] → ${pick}`);
  return pick;
}
