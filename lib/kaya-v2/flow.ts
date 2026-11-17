// Kaya v2 — the conversation flow from the whiteboard, as plain code.
// 1 Collect → 2 Book, with 3 Team callback and 4 Objections & questions branches.
// Pure function: no network, no database. turn.ts does the I/O.
import type { Understanding } from "./understand";
import * as R from "./replies";
import { validName } from "../conversation-state";

export type Stage = "collect" | "book" | "booked" | "callback" | "closed";
export type CallbackReason = keyof typeof R.CALLBACK;
export type V2State = {
  engine: "v2";
  stage: Stage;
  status: "collecting" | "booked" | "team_accepted" | "closed";
  asked: Record<string, number>;
  objections: Record<string, number>;
  answered?: string[];                   // questions already answered — never answered twice
  choiceOffered?: boolean;               // "book or forward to the team?" already asked
  awaitingChoice?: boolean;
  backoutSent?: boolean;
  openers?: string[];
  confirmGcc?: boolean;
  earlyPrice?: number;
  pendingQ?: string[];                   // price / home visit asked early, answered once the car is complete                   // price asked before the car details were complete                  // asked "so the car is GCC, right?"                    // openers already used ("Nice", "Ok"…) — each once per chat
  mediaNoted: string[];
  greeted?: boolean;
  timingDone?: boolean;
  pendingVisit?: Understanding["visit"] | null;
  offered?: { date: string; times: string[] } | null;
  tentative?: { date: string; time: string } | null;
  reason?: CallbackReason | null;
  callbackDone?: boolean;
  ackSent?: boolean;
  followUpDate?: string | null;
  turns: number;
};
export type Ctx = {
  now: Date;
  phone: string;                         // WhatsApp sender, digits only
  media: string[];                       // "photos" | "files" | "voice notes" | "links" in this burst
  textEmpty: boolean;                    // the burst had no typed text
  defaultTime?: (date: string, part?: string | null) => string | null;
};
export type Plan = {
  reply: string;
  updates: Record<string, any>;
  outcome: "none" | "booked" | "callback";
  reason?: string;
  state: V2State;
};

const CANDIDATES = ["12:15", "13:15", "14:15", "15:15", "16:15", "17:15", "11:15", "10:15", "18:15"];
const mins = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const local = (now: Date) => new Date(+now + 4 * 3600e3);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, n: number) => iso(new Date(Date.parse(date + "T12:00:00Z") + n * 86400e3));
const dow = (date: string) => new Date(date + "T12:00:00Z").getUTCDay();
const opensAt = (date: string) => (dow(date) === 5 ? 720 : 600);
const LAST_SLOT = 1110; // 18:30

export function slotOk(date: string, time: string, now: Date): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return false;
  const today = iso(local(now));
  if (date < today || dow(date) === 0) return false;
  const m = mins(time);
  if (m < opensAt(date) || m > LAST_SLOT) return false;
  if (date === today) { const l = local(now); return m >= l.getUTCHours() * 60 + l.getUTCMinutes() + 30; }
  return true;
}
/** Today if a slot is still at least an hour away, else the next opening day. */
export function nextBookableDay(now: Date): string {
  let d = iso(local(now));
  if (!CANDIDATES.some((t) => slotOk(d, t, new Date(+now + 30 * 60e3)))) d = addDays(d, 1);
  while (dow(d) === 0) d = addDays(d, 1);
  return d;
}
function twoOptions(date: string, now: Date, first?: string | null): string[] {
  const valid = CANDIDATES.filter((t) => slotOk(date, t, new Date(+now + 30 * 60e3))).sort((a, b) => mins(a) - mins(b));
  const a = first && slotOk(date, first, now) ? first : valid.find((t) => t === "12:15") ?? valid[0];
  if (!a) return [];
  const b = valid.find((t) => mins(t) >= mins(a) + 180) ?? [...valid].reverse().find((t) => t !== a);
  return b ? [a, b].sort((x, y) => mins(x) - mins(y)) : [a];
}
const title = (s: string) => s.trim().toLowerCase().replace(/\b[a-z]/g, (x) => x.toUpperCase());
const isUae = (p: string) => /^\+?971/.test(p);

export function initialState(): V2State {
  return { engine: "v2", stage: "collect", status: "collecting", asked: {}, objections: {}, mediaNoted: [], turns: 0 };
}

export function plan(c: any, u: Understanding, ctx: Ctx): Plan {
  const prev = c.flow_state && c.flow_state.engine === "v2" ? c.flow_state : null;
  const s: V2State = prev ? JSON.parse(JSON.stringify(prev)) : initialState();
  s.turns++;
  const now = ctx.now;
  const today = iso(local(now));
  const updates: Record<string, any> = {};
  const k = (f: string) => (updates[f] ?? c[f] ?? null) as string | null;
  let outcome: Plan["outcome"] = "none";
  let reason: string | undefined;
  const answers: string[] = [];
  let warm = "";
  const isFirst = !s.greeted && !(c.messages || []).some((m: any) => m.role === "assistant");

  // ── Store everything the customer told us, whatever question it answers ──
  const car = u.car;
  if (car.make && car.make !== c.make) updates.make = car.make;
  if (car.model && car.model !== c.model) updates.model = car.model;
  if (car.year && car.year !== c.year) updates.year = car.year;
  if (car.mileage_km) updates.mileage = String(car.mileage_km);
  if (car.specs && (car.specs !== "Unknown" || !c.specs)) updates.specs = car.specs;
  if (car.loan) updates.loan = car.loan === "yes" ? "Yes" : "No";
  if (u.name && validName(u.name) && !c.name) updates.name = title(u.name);
  // Condition remarks are kept for the team (console summary)
  if (car.condition_note && !String(c.car_conditions || "").includes(car.condition_note))
    updates.car_conditions = [c.car_conditions, car.condition_note].filter(Boolean).join(" | ");
  // "So the car is GCC, right?" → yes / no
  if (s.confirmGcc && !car.specs && u.yes_no) updates.specs = u.yes_no === "yes" ? "GCC" : "Unknown";
  s.confirmGcc = false;
  if (u.phone_number && /\d{9,15}/.test(u.phone_number.replace(/\D/g, ""))) updates.phone_number = u.phone_number;
  if (u.sell_timing.stated) {
    updates.sell_timeline = u.sell_timing.undecided ? "Undecided"
      : u.sell_timing.days_until === 0 ? "Now" : u.sell_timing.days_until != null ? `In ${u.sell_timing.days_until} days` : "Stated";
  }
  const year = Number(k("year")) || null;
  const visitGiven = !!(u.visit.date || u.visit.time || u.visit.flexible || u.visit.part_of_day);
  if (visitGiven && s.stage === "collect") s.pendingVisit = u.visit;

  // ── Attachments: say once per kind that Kaya can't open them ──
  const newMedia = ctx.media.filter((m) => !s.mediaNoted.includes(m));
  const mediaNote = newMedia.length ? `Unfortunately, I'm not able to open ${newMedia.join(" or ")}.` : "";
  s.mediaNoted.push(...newMedia);
  if (ctx.textEmpty && !mediaNote && !isFirst) return finish("");

  // ── Not a lead / not a car ──
  if (s.stage === "closed") {
    if (!(u.wants_to_sell || car.make)) return finish("");
    s.stage = "collect"; s.status = "collecting";
  }
  if (u.not_a_lead && !u.wants_to_sell && !k("make")) {
    s.stage = "closed"; s.status = "closed"; s.greeted = true;
    return finish(R.NOT_A_LEAD);
  }
  if (u.vehicle_kind === "other_vehicle" && !k("make")) {
    s.stage = "closed"; s.status = "closed"; s.greeted = true;
    return finish(R.ONLY_CARS);
  }

  // ── 4 · Objections & questions: answer first — each answer only once ──
  let hard = u.hard_requirement;
  s.answered = s.answered || [];
  let priceNoCar = false;
  for (const q of u.questions) {
    // Price or home visit before the car details are complete: show understanding and collect the car first.
    // Not answered later by itself: only when the customer asks again. Twice at most; a 3rd early push is a normal objection.
    if ((q === "price" || q === "home_visit") && !carComplete() && s.stage === "collect") {
      s.earlyPrice = (s.earlyPrice || 0) + 1;
      if (s.earlyPrice <= 2) {
        priceNoCar = true;
        continue;
      }
    }
    if (q === "price" || q === "home_visit") {
      s.objections[q] = (s.objections[q] || 0) + 1;
      if (s.objections[q] >= 2) hard = true;
    }
    if (s.answered.includes(q) && q !== "location") continue;   // already answered: never repeat (location pin may be re-sent)
    if (q === "location" && answers.includes(R.LOCATION)) continue;
    if (q !== "other") s.answered.push(q);
    answers.push(R.answer(q, { year }));
  }
  if (priceNoCar) hard = false;   // car details first, then the objection
  // Price AND home visit with all car details given → the team calls straight away (Marc's rule)
  const forceTeam = !priceNoCar && u.questions.includes("price") && u.questions.includes("home_visit") && carComplete();

  // ── Booked: answer, handle changes, stay polite ──
  if (s.stage === "booked") {
    if (u.change_request || (visitGiven && (u.visit.date || u.visit.time) && !u.questions.length && !u.ack_only && dateChanged())) {
      reason = u.change_request === "cancel" ? "CANCEL request" : "RESCHEDULE request";
      outcome = "callback";
      return finish(join(...answers, R.CALLBACK.change));
    }
    if (hard || u.wants_person) { outcome = "callback"; reason = "Customer wants the team after booking"; return finish(join(...answers, R.CALLBACK.person)); }
    if (updates.name && !answers.length) return finish("Thank you!");
    if (answers.length) return finish(join(...answers));
    if (u.ack_only || !mediaNote) { if (s.ackSent) return finish(mediaNote); s.ackSent = true; return finish(join(mediaNote, R.ACK_BOOKED)); }
    return finish(mediaNote);
  }

  // ── Customer backs out ("never mind", "forget it") ──
  if (u.backs_out && !u.wants_booking && !visitGiven) {
    if (s.stage === "callback") {
      if (s.backoutSent) return finish("");
      s.backoutSent = true;
      return finish(R.BACKOUT_AFTER_CALLBACK);
    }
    s.backoutSent = true;
    return toCallback("backout");
  }

  // ── Pushed objection: offer the choice once (book, or the team) ──
  if (s.awaitingChoice && s.stage !== "callback") {
    s.awaitingChoice = false;
    const wantsBook = u.wants_booking || visitGiven || u.yes_no === "yes" && !u.wants_person;
    if (u.wants_person && !hard) return toCallback("forward", true);
    if (!wantsBook || hard || u.wants_person) return toCallback("requirement", true);
    hard = false;
  }
  if (s.stage !== "callback" && (hard || forceTeam)) {
    if (forceTeam || s.choiceOffered) return toCallback("requirement", true);
    s.choiceOffered = true; s.awaitingChoice = true;
    return finish(join(mediaNote, ...answers, R.CHOICE));
  }

  // ── Triggers for 3 · Team callback ──
  if (s.stage !== "callback") {
    if (u.wants_person) return toCallback("person");
    if (k("specs") === "Non-GCC") return toCallback("non_gcc");
    if (u.vehicle_kind === "truck_bus") return toCallback("truck_bus");
    if (u.hiyaza) return toCallback("hiyaza");
    if (u.more_cars) return toCallback("more_cars");
    if (u.buyer_only && !k("make")) return toCallback("buyer");
  }

  // ── Callback stage: collect what the team needs; go back to booking if they now want to come ──
  if (s.stage === "callback") {
    const canRebook = ["later", "undecided", "stuck", "person", "backout"].includes(String(s.reason));
    if (canRebook && (u.wants_booking || u.visit.date || u.visit.flexible || u.visit.time) && !hard) {
      s.stage = "book"; s.status = "collecting"; s.reason = null;
      return book(answers);
    }
    if (touchedContact()) outcome = "callback", reason = "Customer added details";
    const ask = callbackAsk();
    if (ask) return finish(join(mediaNote, ...answers, ask));
    if (!s.callbackDone && (touchedContact() || !answers.length)) { s.callbackDone = true; return finish(join(mediaNote, ...answers, R.CALLBACK_DONE)); }
    if (answers.length) return finish(join(mediaNote, ...answers));
    if (u.ack_only && !s.ackSent) { s.ackSent = true; return finish(R.ACK_DEFAULT); }
    return finish(mediaNote);
  }

  // ── 1 · Collect ──
  if (s.stage === "collect" && priceNoCar && !forceTeam) {
    s.greeted = true;
    const intro = s.earlyPrice === 1 ? R.PRICE_NEED_INFO : R.PRICE_NEED_INFO_AGAIN;
    let next: string;
    if (!k("make")) { s.asked.make = Math.max(s.asked.make || 0, 1); next = R.SHARE_CAR; }
    else next = nextCollect();
    if (next === "STUCK" || next === "BOOK") next = "";
    return finish(join(isFirst ? `${R.salutation(now)}! I'm Kaya from Mister Wheelz 😊` : "", mediaNote, ...answers, intro, next));
  }
  if (s.stage === "collect") {
    if (isFirst) {
      s.greeted = true;
      if (k("name")) {
        const next = nextCollect();
        if (next === "BOOK") { s.stage = "book"; return book([R.greetingWithName(now, k("name")!), ...answers], true); }
        return finish(join(R.greetingWithName(now, k("name")!), mediaNote, ...answers, next));
      }
      s.asked.name = 1;
      if (!answers.length && !mediaNote) return finish(R.greeting(now));
      return finish(join(`${R.salutation(now)}! I'm Kaya from Mister Wheelz 😊`, mediaNote, ...answers, "Before we start may I know your name please?"));
    }
    // Timing answer decides: book, or the team follows up
    if (!s.timingDone && (u.sell_timing.stated || visitGiven || u.wants_booking)) {
      const d = u.sell_timing.days_until;
      if (u.sell_timing.undecided && !visitGiven && !u.wants_booking) return toCallback("undecided");
      if (d != null && d > 7 && !u.visit.date) { s.followUpDate = addDays(today, d); return toCallback("later"); }
      s.timingDone = true;
    }
    const next = nextCollect();
    if (next === "STUCK") return toCallback("stuck");
    if (next !== "BOOK") {
      const lower = (q: string) => q[0].toLowerCase() + q.slice(1);
      // "I want to sell my car" with no details yet → reassure once, then ask the car
      if (!answers.length && u.wants_to_sell && !k("make") && !(s.answered || []).includes("sell_ack")) {
        s.answered = [...(s.answered || []), "sell_ack"];
        return finish(join(mediaNote, R.SELL_ACK, next));
      }
      // Condition remark → acknowledge it, never ignore it
      if (!answers.length && car.condition_note && car.condition_tone !== "neutral") {
        const ack = car.condition_tone === "negative" ? R.CONDITION_NEGATIVE : R.CONDITION_POSITIVE;
        if (car.condition_tone !== "negative" && R.ASK.specs.includes(next)) { s.confirmGcc = true; return finish(join(mediaNote, `${ack} So the car is GCC, right?`)); }
        return finish(join(mediaNote, `${ack} ${next}`));
      }
      // Specs unknown → reassure instead of a flat "Alright"
      if (!answers.length && updates.specs === "Unknown") return finish(join(mediaNote, R.SPECS_UNKNOWN, next));
      // Very low mileage for its age → say so (normal is 15–20k km a year)
      const low = !answers.length && updates.mileage && R.lowMileage(Number(updates.mileage), Number(k("year")), now);
      if (low) return finish(join(mediaNote, `${opener("Great")}, that's very low mileage for a ${k("year")}! ${next}`.replace(/^, /, "")));
      const preferred = answers.length ? "" : R.filler(Object.keys(updates));
      const filler = preferred ? opener(preferred) : "";
      return finish(join(mediaNote, ...answers, filler ? `${filler}, ${lower(next)}` : next));
    }
    s.stage = "book";
    return book(mediaNote ? [mediaNote, ...answers] : answers, true);
  }

  // ── 2 · Book ──
  return book(mediaNote ? [mediaNote, ...answers] : answers);

  // ───────────────────────── helpers ─────────────────────────
  /** Each opener once per chat: the second time "Nice" becomes "Ok", then "Got it", "Thanks". */
  function opener(preferred: string): string {
    s.openers = s.openers || [];
    const pick = [preferred, "Ok", "Got it", "Thanks"].find((o) => !s.openers!.includes(o)) ?? "";
    if (pick) s.openers.push(pick);
    return pick;
  }
  function carComplete() { return !!(k("make") && k("model") && k("year") && k("mileage")); }
  function dateChanged() {
    const d = u.visit.date ?? c.appointment_date, t = u.visit.time ?? c.appointment_time;
    return d !== c.appointment_date || t !== c.appointment_time;
  }
  function touchedContact() { return ["name", "phone_number", "make", "model", "year", "mileage"].some((f) => f in updates); }
  function ask(key: string): string | null {
    const n = s.asked[key] || 0;
    if (n >= 2) return null;
    s.asked[key] = n + 1;
    // Second try for the model: help with examples that fit the brand (e.g. Toyota → Land Cruiser, Prado, Corolla)
    if (n === 1 && (key === "model" || key === "model_year")) return R.askModelAgain(k("make"), key === "model_year");
    return R.ASK[key][n];
  }
  function nextCollect(): string {
    if (!k("make")) return ask("make") ?? "STUCK";
    if (!k("model") && !k("year")) { const q = ask("model_year"); if (q) return q; }
    else if (!k("model")) { const q = ask("model"); if (q) return q; }
    else if (!k("year")) { const q = ask("year"); if (q) return q; }
    if (!k("mileage")) { const q = ask("mileage"); if (q) return q; }
    if (!k("specs")) { const q = ask("specs"); if (q) return q; }
    if ((Number(k("year")) || 0) >= 2020 && !k("loan")) { const q = ask("loan"); if (q) return q; }
    if (!s.timingDone && !s.pendingVisit && !u.wants_booking) { const q = ask("timing"); if (q) return q; }
    return "BOOK";
  }
  function callbackAsk(): string | null {
    if (s.reason === "more_cars" || s.reason === "buyer") {
      if (!k("name") && !s.asked.cb_name) { s.asked.cb_name = 1; return R.CALLBACK_NAME; }
      if (!isUae(ctx.phone) && !k("phone_number") && !s.asked.cb_phone) { s.asked.cb_phone = 1; return R.CALLBACK_PHONE; }
      return null;
    }
    const carAsks: [string, () => boolean][] = [
      ["make", () => !k("make")],
      ["model_year", () => !k("model") && !k("year")],
      ["model", () => !k("model")],
      ["year", () => !k("year")],
      ["mileage", () => !k("mileage")],
    ];
    for (const [key, missing] of carAsks) {
      if (missing() && !s.asked["cb_" + key] && !(s.asked[key] >= 2)) { s.asked["cb_" + key] = 1; return R.ASK[key][0]; }
      if (missing() && key === "model_year") break;
    }
    if (!k("name") && !s.asked.cb_name) { s.asked.cb_name = 1; return R.CALLBACK_NAME; }
    if (!isUae(ctx.phone) && !k("phone_number") && !s.asked.cb_phone) { s.asked.cb_phone = 1; return R.CALLBACK_PHONE; }
    return null;
  }
  function toCallback(r: CallbackReason, skipAnswers = false): Plan {
    if (skipAnswers) answers.length = 0;
    s.stage = "callback"; s.status = "team_accepted"; s.reason = r; s.greeted = true;
    outcome = "callback";
    reason = { requirement: "Price / estimate / home visit is a must", person: "Customer asked for the team", non_gcc: "Non-GCC car", later: `Sells later — follow up ${s.followUpDate ?? ""}`, undecided: "Undecided seller", more_cars: "Several cars", truck_bus: "Truck / bus", hiyaza: "Hiyaza", buyer: "Buyer only", change: "Booking change", stuck: "Conversation stuck", backout: "Customer backed out", forward: "Price / estimate / home visit is a must — chose the team" }[r];
    if (r === "later" && s.followUpDate) updates.car_conditions = [c.car_conditions, `Follow-up: ${s.followUpDate}`].filter(Boolean).join(" | ");
    const intro = isFirst ? `${R.salutation(now)}! I'm Kaya from Mister Wheelz 😊` : "";
    const askNext = callbackAsk();
    if (!askNext) s.callbackDone = true;
    return finish(join(intro, mediaNote, ...answers, R.CALLBACK[r], askNext ?? ""));
  }
  function book(lead: string[], entering = false): Plan {
    s.stage = "book";
    // A warm opener when the customer just told us when they'll sell (e.g. "when I get a good price" → "Of course, …")
    warm = entering && u.sell_timing.stated && !lead.length ? (u.sell_timing.conditional ? "Of course" : "Great") : "";
    const v = { ...(entering && s.pendingVisit ? s.pendingVisit : {}), ...pick(u.visit) } as Understanding["visit"];
    s.pendingVisit = null;
    // Resisting the booking (a plain "no" to the day question) → offer: book, or the team
    if (!entering && u.yes_no === "no" && !s.tentative && !v.date && !v.time && !v.flexible) {
      if (s.choiceOffered) return toCallback("requirement", true);
      s.choiceOffered = true; s.awaitingChoice = true;
      return finish(join(...lead, R.CHOICE));
    }
    // Answer to "Shall I book you on …?"
    if (s.tentative && !v.date && !v.time) {
      if (u.yes_no === "yes" || u.wants_booking) return confirm(s.tentative.date, s.tentative.time, lead);
      if (u.yes_no === "no") { s.tentative = null; return askDay(lead); }
    }
    // Picking one of the two offered times
    if (s.offered && !v.date && (v.time || u.yes_no === "yes")) {
      v.date = s.offered.date;
      if (!v.time) v.time = s.offered.times[0];
    }
    if (!v.date && v.time) v.date = slotOk(today, v.time, now) ? today : s.offered?.date ?? nextBookableDay(now);
    if (v.date) {
      if (dow(v.date) === 0) { s.offered = null; return finish(join(...lead, R.sundayClosed(now), R.ASK.day_time[1])); }
      if (v.date < today) v.date = nextBookableDay(now);
      let time = v.time;
      if (!time) {
        const d = ctx.defaultTime?.(v.date, v.part_of_day) ?? null;
        time = d && slotOk(v.date, d, now) ? d : twoOptions(v.date, now)[0] ?? null;
        if (!time) return offer(lead, nextBookableDay(new Date(Date.parse(v.date + "T20:00:00Z"))), `We're fully booked on ${R.inspectionDay(v.date)}.`);
      }
      if (!slotOk(v.date, time, now)) {
        const opts = twoOptions(v.date, now);
        if (!opts.length) return offer(lead, nextBookableDay(now), v.date === today ? R.closedNow("tomorrow", "10 am") : "");
        s.offered = { date: v.date, times: opts };
        const label = R.dayLabel(v.date, today, addDays(today, 1));
        const opens = opensAt(v.date) === 720 ? "12 pm" : "10 am";
        return finish(join(...lead, R.closedThen(label, opens), opts.length === 2 ? R.offerTwo("on " + label, opts[0], opts[1]) : `Would ${R.inspectionTime(opts[0])} suit you?`));
      }
      if (v.tentative) { s.tentative = { date: v.date, time }; return finish(join(...lead, R.confirmTentative(v.date, time))); }
      return confirm(v.date, time, lead);
    }
    if (v.flexible || u.wants_booking || (s.asked.day_time || 0) >= 1 && !u.questions.length) {
      if (s.offered && (s.asked.offer || 0) >= 2) return toCallback("stuck");
      const day = nextBookableDay(now);
      const l = local(now), m = l.getUTCHours() * 60 + l.getUTCMinutes();
      const closedNote = day !== today && (dow(today) === 0 || m >= 19 * 60 || m < opensAt(today)) ? R.closedNow(day === addDays(today, 1) ? "tomorrow" : "on " + R.inspectionDay(day), opensAt(day) === 720 ? "12 pm" : "10 am") : "";
      // First time: ask an open question ("what time can you bring the car this afternoon?"); after that, two times
      if (!s.asked.openTime) {
        s.asked.openTime = 1;
        const when = day !== today ? (day === addDays(today, 1) ? "tomorrow" : "on " + R.inspectionDay(day))
          : m < 15 * 60 ? "this afternoon" : "today or tomorrow";
        return finish(join(...lead, closedNote, R.openTime(when)));
      }
      return offer(lead, day, closedNote);
    }
    return askDay(lead);
  }
  function askDay(lead: string[]): Plan {
    let q = ask("day_time");
    if (q && warm) q = `${warm}, ${q[0].toLowerCase()}${q.slice(1)}`;
    if (!q) return offer(lead, nextBookableDay(now), "");
    return finish(join(...lead, q));
  }
  function offer(lead: string[], day: string, note: string): Plan {
    s.asked.offer = (s.asked.offer || 0) + 1;
    if (s.asked.offer > 2) return toCallback("stuck");
    const opts = twoOptions(day, now, ctx.defaultTime?.(day) ?? null);
    if (!opts.length) return toCallback("stuck");
    s.offered = { date: day, times: opts };
    const label = day === today ? "today" : day === addDays(today, 1) ? "tomorrow" : "on " + R.inspectionDay(day);
    const line = opts.length === 2 ? R.offerTwo(label, opts[0], opts[1]) : `Would ${R.inspectionTime(opts[0])} ${label} suit you?`;
    return finish(join(...lead, note, warm && !note ? `${warm}! ${line}` : line));
  }
  function confirm(date: string, time: string, lead: string[]): Plan {
    s.stage = "booked"; s.status = "booked"; s.offered = null; s.tentative = null;
    updates.appointment_date = date; updates.appointment_time = time; updates.appointment = `${date} ${time}`;
    outcome = "booked";
    const needName = !k("name"), needPhone = !isUae(ctx.phone) && !k("phone_number");
    const after = needName && needPhone ? R.AFTER_BOOKING_NAME_PHONE : needName ? R.AFTER_BOOKING_NAME : needPhone ? R.AFTER_BOOKING_PHONE : "";
    return finish(join(...lead, R.booked(date, time, now), after));
  }
  function pick(v: Understanding["visit"]) {
    const o: any = {};
    for (const [key, val] of Object.entries(v)) if (val) o[key] = val;
    return o;
  }
  function join(...parts: string[]) { return parts.filter((p) => p && p.trim()).join("\n\n"); }
  function finish(reply: string): Plan {
    // Never repeat: drop any paragraph Kaya already sent in this chat (the location pin may be re-sent on request).
    const sent = new Set<string>();
    // The location card has blank lines inside it, so it is kept as one block when splitting.
    const PIN = "\u0000LOCATION\u0000";
    const parts = (t: string) => t.split(R.LOCATION).join(PIN).split(/\n\n+/).map((p) => p.trim());
    for (const m of c.messages || []) if (m.role === "assistant") for (const para of parts(String(m.content))) sent.add(para);
    if (reply) {
      const kept = parts(reply).filter((p) => p && (!sent.has(p) || (p === PIN && (u.questions.includes("location") || outcome === "booked"))))
        .map((p) => (p === PIN ? R.LOCATION : p));
      if (!kept.length) {
        if (s.stage !== "callback" && s.stage !== "booked") { s.stage = "collect"; return toCallback("stuck"); }
        reply = "";
      } else reply = kept.join("\n\n");
    }
    updates.flow_state = { ...s, version: 1 }; // version 1 → crons (nudge, Bigin reconcile) read status
    return { reply, updates, outcome, reason, state: s };
  }
}
