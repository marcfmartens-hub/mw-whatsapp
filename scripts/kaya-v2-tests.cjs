// Kaya v2 flow tests — one or more per box on the whiteboard. No network: the AI reading
// of each message is given as a fixture, so only the flow (what Kaya does with it) is tested.
const fs = require('fs'), ts = require('typescript'), assert = require('assert/strict'), path = require('path');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, resolveJsonModule: true, esModuleInterop: true } }).outputText, f);
const Module = require('module'), real = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id.startsWith('@/')) return real.call(this, path.resolve(__dirname, '../', id.slice(2)), parent, ...rest);
  return real.call(this, id, parent, ...rest);
};
const { plan } = require('../lib/kaya-v2/flow.ts');
const { EMPTY } = require('../lib/kaya-v2/understand.ts');
const R = require('../lib/kaya-v2/replies.ts');

const WED_10AM = new Date('2026-11-11T06:00:00Z');   // Wednesday 10:00 Dubai
const SAT_10AM = new Date('2026-11-14T06:00:00Z');
const FRI_9PM = new Date('2026-11-13T17:00:00Z');
const U = (p = {}) => {
  const u = JSON.parse(JSON.stringify(EMPTY));
  for (const [k, v] of Object.entries(p)) u[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...u[k], ...v } : v;
  return u;
};
const chat = (extra = {}) => ({ phone: '971501234567', messages: [], ...extra });
function say(c, u, opts = {}) {
  const r = plan(c, U(u), { now: opts.now || WED_10AM, phone: c.phone, media: opts.media || [], textEmpty: !!opts.textEmpty, defaultTime: opts.defaultTime || (() => '12:15') });
  Object.assign(c, r.updates);
  c.messages.push({ role: 'user', content: opts.text || JSON.stringify(u) });
  if (r.reply) c.messages.push({ role: 'assistant', content: r.reply });
  return r;
}
const car = { make: 'Toyota', model: 'Camry', year: '2018', mileage_km: 120000, specs: 'GCC' };
let passed = 0; const t = (name, fn) => { fn(); passed++; };

t('1 Collect: ad text gets the agreed greeting', () => {
  const c = chat(); const r = say(c, {});
  assert.equal(r.reply, "Good morning! I'm Kaya from Mister Wheelz 😊 Before we start may I know your name please?");
});
t('1 Collect: name in any wording, then asks for the car', () => {
  const c = chat(); say(c, {}); const r = say(c, { name: 'asif' });
  assert.equal(c.name, 'Asif'); assert.match(r.reply, /Which car are you planning to sell/);
});
t('1 Collect: a time is never stored as a name', () => {
  const c = chat(); say(c, {}); say(c, { name: 'As soon as possible' }); assert.equal(c.name, undefined);
});
t('1 Collect: name in the first message → greeting with name + next question', () => {
  const c = chat(); const r = say(c, { name: 'Champa', wants_to_sell: true });
  assert.match(r.reply, /Nice to meet you, Champa\./); assert.match(r.reply, /Which car/);
});
t('1 Collect: everything in one message → only the missing question (timing)', () => {
  const c = chat(); say(c, {}); const r = say(c, { name: 'Ajit', car });
  assert.match(r.reply, /When are you planning to sell/); assert.doesNotMatch(r.reply, /model|mileage|GCC/i);
});
t('1 Collect: car without name skips the name until booking', () => {
  const c = chat(); say(c, {}); const r = say(c, { car: { make: 'Nissan', model: 'Sunny' } });
  assert.match(r.reply, /What year/); assert.doesNotMatch(r.reply, /name/);
});
t('1 Collect: answer to a different question lands in the right field', () => {
  const c = chat({ name: 'Ershad' }); say(c, {}); say(c, { car: { make: 'Nissan', model: 'X-Trail', year: '2016' } });
  const r = say(c, { car: { mileage_km: 152000, specs: 'GCC' } });
  assert.equal(c.mileage, '152000'); assert.equal(c.specs, 'GCC'); assert.match(r.reply, /When are you planning/);
});
t('1 Collect: loan only asked for 2020 or newer', () => {
  let c = chat({ name: 'A' }); say(c, {}); let r = say(c, { car: { ...car, year: '2024' } }); assert.match(r.reply, /loan/);
  c = chat({ name: 'A' }); say(c, {}); r = say(c, { car }); assert.doesNotMatch(r.reply, /loan/);
});
t('1→2: selling now / any time → two time options', () => {
  const c = chat({ name: 'Ali' }); say(c, {}); say(c, { car });
  const r = say(c, { sell_timing: { stated: true, days_until: 0 }, visit: { flexible: true } });
  assert.match(r.reply, /Would 12:15 pm or 3:15 pm today suit you\?/);
});
t('2 Book: picking an offered time books it, then asks the name', () => {
  const c = chat(); say(c, {}); say(c, { car }); say(c, { sell_timing: { stated: true, days_until: 0 }, visit: { flexible: true } });
  const r = say(c, { visit: { time: '12:15' } });
  assert.equal(r.outcome, 'booked'); assert.equal(c.appointment_date, '2026-11-11'); assert.match(r.reply, /confirmed for\n\nWednesday 11th of November at 12:15 pm/);
  assert.match(r.reply, /maps\.app/); assert.match(r.reply, /May I have your name for the booking\?$/);
});
t('2 Book: a day without a time books 12:15 (or the next free :15)', () => {
  const c = chat({ name: 'B' }); say(c, {}); say(c, { car }); say(c, { sell_timing: { stated: true, days_until: 1 } });
  const r = say(c, { visit: { date: '2026-11-12' } }, { defaultTime: () => '13:15' });
  assert.equal(r.outcome, 'booked'); assert.equal(c.appointment_time, '13:15');
});
t('2 Book: Sunday is closed, Saturday is open', () => {
  const c = chat({ name: 'Jitender' }); say(c, {}); say(c, { car }); say(c, { sell_timing: { stated: true, days_until: 2 } });
  let r = say(c, { visit: { date: '2026-11-15' } }); assert.match(r.reply, /closed on Sundays/); assert.notEqual(r.outcome, 'booked');
  r = say(c, { visit: { date: '2026-11-14', time: '17:00' } }); assert.equal(r.outcome, 'booked'); assert.equal(c.appointment_date, '2026-11-14');
});
t('2 Book: Sunday wording on Friday and Saturday', () => {
  assert.match(R.sundayClosed(new Date('2026-11-13T08:00:00Z')), /tomorrow \(Saturday\)/);
  assert.match(R.sundayClosed(SAT_10AM), /open again on Monday/);
});
t('2 Book: outside opening hours → two valid times that day', () => {
  const c = chat({ name: 'CP' }); say(c, {}); say(c, { car }); say(c, { sell_timing: { stated: true, days_until: 0 } });
  const r = say(c, { visit: { date: '2026-11-12', time: '09:00' } });
  assert.match(r.reply, /outside our opening hours/); assert.match(r.reply, /Would .* or .* suit you\?/);
});
t('2 Book: closed right now → next opening day', () => {
  const c = chat({ name: 'D' }); say(c, {}, { now: FRI_9PM }); say(c, { car }, { now: FRI_9PM });
  const r = say(c, { sell_timing: { stated: true, days_until: 0 }, visit: { flexible: true } }, { now: FRI_9PM });
  assert.match(r.reply, /closed right now, but we open again tomorrow at 10 am/); assert.match(r.reply, /tomorrow suit you/);
});
t('2 Book: "Saturday maybe" asks before booking', () => {
  const c = chat({ name: 'E' }); say(c, {}); say(c, { car }); say(c, { sell_timing: { stated: true, days_until: 3 } });
  let r = say(c, { visit: { date: '2026-11-14', tentative: true } }); assert.match(r.reply, /Shall I book you on Saturday 14th of November at 12:15 pm\?/);
  r = say(c, { yes_no: 'yes' }); assert.equal(r.outcome, 'booked');
});
t('2 Book: non-UAE number is asked after booking', () => {
  const c = chat({ phone: '66990623298', name: 'Ahmad' }); say(c, {}); say(c, { car }); say(c, { sell_timing: { stated: true, days_until: 0 } });
  const r = say(c, { visit: { date: '2026-11-12', time: '11:00' } }); assert.match(r.reply, /UAE contact number/);
});
t('3 Callback: selling in 1+ week → follow-up date', () => {
  const c = chat({ name: 'F' }); say(c, {}); say(c, { car });
  const r = say(c, { sell_timing: { stated: true, days_until: 14 } });
  assert.equal(r.outcome, 'callback'); assert.match(c.car_conditions, /Follow-up: 2026-11-25/); assert.match(r.reply, /closer to the time/);
});
t('3 Callback: undecided', () => {
  const c = chat({ name: 'G' }); say(c, {}); say(c, { car });
  const r = say(c, { sell_timing: { stated: true, undecided: true } }); assert.equal(r.outcome, 'callback'); assert.equal(c.flow_state.status, 'team_accepted');
});
t('3 Callback: non-GCC → message, then missing details, name', () => {
  const c = chat(); say(c, {});
  let r = say(c, { car: { make: 'Chevrolet', model: 'Captiva', year: '2024', specs: 'Non-GCC' } });
  assert.equal(r.outcome, 'callback'); assert.match(r.reply, /don't buy every non-GCC car/); assert.match(r.reply, /mileage/);
  r = say(c, { car: { mileage_km: 60000 } }); assert.match(r.reply, /name for the team/);
  r = say(c, { name: 'Robin' }); assert.equal(r.reply, R.CALLBACK_DONE);
});
t('3 Callback: several cars / truck / hiyaza / buyer only', () => {
  for (const [u, re] of [[{ more_cars: true, wants_to_sell: true }, /each car/], [{ vehicle_kind: 'truck_bus' }, /trucks and buses/], [{ hiyaza: true }, /Hiyaza/], [{ buyer_only: true }, /sales team/]]) {
    const c = chat({ name: 'H' }); say(c, {}); const r = say(c, u); assert.equal(r.outcome, 'callback'); assert.match(r.reply, re);
  }
});
t('3 Callback: asks for a person', () => {
  const c = chat(); say(c, {}); const r = say(c, { wants_person: true }); assert.equal(r.outcome, 'callback'); assert.match(r.reply, /call you/);
});
t('3 Callback: a later booking wish goes back to the booking track', () => {
  const c = chat({ name: 'Isaac' }); say(c, {}); say(c, { car }); say(c, { sell_timing: { stated: true, undecided: true } });
  const r = say(c, { visit: { date: '2026-11-11', time: '13:00' }, wants_booking: true }); assert.equal(r.outcome, 'booked');
});
t('4 Questions: price once → answer, then back to the same step', () => {
  const c = chat({ name: 'J' }); say(c, {}); say(c, { car: { make: 'VW', model: 'Golf', year: '2018' } });
  const r = say(c, { questions: ['price'] });
  assert.match(r.reply, /final price after the inspection/); assert.match(r.reply, /kilometres|mileage/); assert.notEqual(r.outcome, 'callback');
});
t('4 Questions: price on a 2020+ car offers cash or consignment', () => {
  const c = chat({ name: 'K' }); say(c, {}); say(c, { car: { make: 'MG', model: '5', year: '2023' } });
  const r = say(c, { questions: ['price'] }); assert.match(r.reply, /cash on the spot, or consignment/);
});
t('4 Questions: price asked again → hard requirement → callback', () => {
  const c = chat({ name: 'L' }); say(c, {}); say(c, { car }); say(c, { questions: ['price'] });
  const r = say(c, { questions: ['price'] }); assert.equal(r.outcome, 'callback'); assert.match(r.reply, /ask our team to call you/);
});
t('4 Questions: home visit once → branch answer + continue; "I will not come" → callback', () => {
  const c = chat({ name: 'Faraz' }); say(c, {}); say(c, { car }); say(c, { sell_timing: { stated: true, days_until: 3 } });
  let r = say(c, { questions: ['home_visit'] }); assert.match(r.reply, /done at our branch/); assert.match(r.reply, /Which day/); assert.equal(r.outcome, 'none');
  r = say(c, { questions: ['home_visit'], hard_requirement: true }); assert.equal(r.outcome, 'callback');
});
t('4 Questions: free inspection / hours / location answered, not handed off', () => {
  const c = chat({ name: 'Carla' }); say(c, {}); say(c, { car }); say(c, { sell_timing: { stated: true, days_until: 5 } });
  let r = say(c, { questions: ['free'] }); assert.match(r.reply, /completely free/); assert.equal(r.outcome, 'none');
  r = say(c, { questions: ['hours', 'location'] }); assert.match(r.reply, /10 am to 7 pm/); assert.match(r.reply, /maps\.app/);
});
t('4 Questions: question in the first message is answered after the greeting', () => {
  const c = chat(); const r = say(c, { questions: ['how_it_works'] });
  assert.match(r.reply, /^Good morning! I'm Kaya/); assert.match(r.reply, /cash on the spot/); assert.match(r.reply, /may I know your name please\?$/);
});
t('Not a lead: polite reply once, then silence', () => {
  const c = chat(); let r = say(c, { not_a_lead: true }); assert.equal(r.reply, R.NOT_A_LEAD); assert.equal(r.outcome, 'none');
  r = say(c, { ack_only: true }); assert.equal(r.reply, '');
});
t('Media: said once per kind; photo-only follow-ups get no reply', () => {
  const c = chat({ name: 'M' }); say(c, {});
  let r = say(c, {}, { media: ['photos'], textEmpty: true }); assert.match(r.reply, /not able to open photos/);
  r = say(c, {}, { media: ['photos'], textEmpty: true }); assert.equal(r.reply, '');
});
t('After booking: thanks → one goodbye; then silence; name is saved', () => {
  const c = chat(); say(c, {}); say(c, { car }); say(c, { sell_timing: { stated: true, days_until: 0 } }); say(c, { visit: { date: '2026-11-12', time: '11:00' } });
  let r = say(c, { name: 'Nektarios' }); assert.equal(c.name, 'Nektarios'); assert.equal(r.reply, 'Thank you!');
  r = say(c, { ack_only: true }); assert.equal(r.reply, R.ACK_BOOKED);
  r = say(c, { ack_only: true }); assert.equal(r.reply, '');
});
t('After booking: reschedule → call center', () => {
  const c = chat({ name: 'N' }); say(c, {}); say(c, { car }); say(c, { sell_timing: { stated: true, days_until: 0 } }); say(c, { visit: { date: '2026-11-12', time: '11:00' } });
  const r = say(c, { change_request: 'reschedule' }); assert.equal(r.outcome, 'callback'); assert.match(r.reason, /RESCHEDULE/);
});
t('Never the same message twice in a row → team takes over', () => {
  const c = chat({ name: 'O' }); say(c, {}); say(c, { car }); say(c, { sell_timing: { stated: true, days_until: 3 } });
  let r; for (let i = 0; i < 6 && (!r || r.outcome !== 'callback'); i++) r = say(c, {});
  assert.equal(r.outcome, 'callback');
});
console.log(`Kaya v2 flow: ${passed} tests passed`);
