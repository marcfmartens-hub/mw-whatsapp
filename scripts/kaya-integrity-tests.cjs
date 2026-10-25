const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function load(file, mocks = {}, cache = new Map()) {
  const filename = path.resolve(file);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} }; cache.set(filename, module);
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', js)(id => {
    if (id in mocks) return mocks[id];
    if (id.startsWith('@/')) return load(id.slice(2) + '.ts', mocks, cache);
    if (id.startsWith('.')) { const p = path.resolve(path.dirname(filename), id); return fs.existsSync(p + '.ts') ? load(p + '.ts', mocks, cache) : require(p); }
    return require(id);
  }, module, module.exports);
  return module.exports;
}
const policy = load('lib/conversation-state.ts');
const { planTurn, flowState, validName, slotValid, expectedPrice, supportedVehicle, inspectionBooked } = policy;
const now = new Date('2026-10-23T08:00:00Z');
const base = () => ({ phone: '971500000000', name: 'Alex', make: 'Toyota', model: 'Camry', year: '2021', mileage: '100000', specs: 'GCC', loan: 'No', sell_timeline: 'Soon', messages: [], flow_state: { version: 1, status: 'collecting', question: 'time' } });
const withState = (state, extra = {}) => ({ ...base(), ...extra, flow_state: { version: 1, status: 'collecting', ...state } });
const turn = (chat, text) => planTurn(chat, text, {}, now);
const booked = () => withState({ status: 'booked', proposedDate: '2026-10-24', proposedTime: '15:00' }, { appointment_date: '2026-10-24', appointment_time: '15:00' });
let cases = 0;
function test(label, fn) { fn(); cases++; }

// One focused regression per reviewed conversation; examples are synthetic and
// contain no customer identities, phone numbers, VINs or private links.
test('01 imported market requires verification before booking', () => { const t = turn(base(), 'Genesis G70 2022 33000 km\nAmerican'); assert.match(t.reply, /engine number/); assert.equal(t.state.mulkiyaPending, true); });
test('02 customer will contact is not a booked visit or callback', () => { const t = turn(booked(), 'When I am ready I will contact you'); assert.equal(t.state.status, 'customer_will_contact'); assert.equal(t.state.consent, 'declined'); assert.equal(t.updates.appointment_date, null); });
test('03 Sharjah inspection and false names', () => { assert.equal(validName('Only'), false); const t = turn(base(), 'I need inspection in Sharjah'); assert.match(t.reply, /inspections take place at our branch/); assert.notEqual(t.state.status, 'booked'); });
test('04 combined time and location retains both', () => { const t = turn(base(), "Today 3 o'clock, send location please"); assert.match(t.reply, /maps.app/); assert.equal(t.updates.appointment_time, '15:00'); assert.equal(t.confirm, true); });
test('05 price-dependent selling answer does not repeat timeline', () => { const t = turn(withState({ question: 'sell' }), 'When I get a good price'); assert.match(t.reply, /final price comes right after a free/); assert.doesNotMatch(t.reply, /When would you like to sell/); });
test('06 Friday morning outside opening hours is never stored as booking', () => { const t = turn(base(), 'Today 9 am'); assert.notEqual(t.state.status, 'booked'); assert.equal(t.updates.appointment_time, null); });
test('07 no hurry is respected', () => { const t = turn(base(), "I'm not in a hurry"); assert.equal(t.state.question, 'callback'); assert.doesNotMatch(t.reply, /what time.*tomorrow/i); });
test('08 buying a replacement does not mean selling two cars', () => { const t = turn(base(), "I'm buying another car next week and don't want to keep 2 cars"); assert.equal(t.state.vehicles, undefined); });
test('09 explicit purchasing-team acceptance', () => { const t = turn(withState({ question: 'choice' }), 'Yes please, purchasing team sounds good'); assert.equal(t.state.status, 'team_accepted'); assert.equal(t.state.consent, 'accepted'); });
test('10 ASAP cannot inherit an invented 6pm booking', () => { const t = turn(withState({ proposedDate: '2026-10-24' }), 'No I mean asap'); assert.notEqual(t.state.status, 'booked'); assert.equal(t.updates.appointment_time, null); });
test('11 images do not erase pending timing question', () => { const t = turn(base(), '[photo]'); assert.notEqual(t.state.status, 'booked'); assert.match(t.reply, /can't read photos/); });
test('12 seat-cover seller leaves booking flow', () => { const t = turn(withState({}, { make: null, model: null, year: null }), 'These are seat cover prices'); assert.equal(t.state.status, 'closed'); });
test('13 clear call acceptance after deferral is accepted once', () => { const t = turn(withState({ question: 'callback' }), 'Sure'); assert.equal(t.state.status, 'team_accepted'); assert.doesNotMatch(t.reply, /just to confirm/i); });
test('14 trim is not invented into an unknown vehicle model', () => { const v = supportedVehicle('s drive 20i, 2021, GCC', {}); assert.equal(v.model, undefined); assert.equal(v.year, '2021'); });
test('15 looking for Marc is not a car enquiry', () => { const t = turn(withState({}, { make: null, model: null }), 'Looking for Marc'); assert.equal(t.state.status, 'closed'); });
test('16 rounding time requires agreement', () => { const t = turn(base(), 'Tomorrow 3.45pm'); assert.equal(t.state.status, 'awaiting_confirmation'); assert.equal(t.updates.appointment_time, null); assert.match(t.reply, /16:00/); });
test('17 explicit non-GCC cannot become GCC', () => { const t = turn(base(), 'No gcc, Korean import'); assert.equal(t.updates.specs, 'Unknown'); assert.equal(t.state.mulkiyaPending, true); });
test('18 I will contact is not callback acceptance', () => { const t = turn(withState({ question: 'callback' }), 'I will contact'); assert.equal(t.state.consent, 'declined'); assert.equal(t.state.status, 'customer_will_contact'); });
test('19 answer location and free inspection before asking a missing name', () => { const t = turn(withState({ proposedDate: '2026-10-24', question: 'exact_time' }, { name: null }), '10am, where are you located? Do you do a free inspection?'); assert.match(t.reply, /maps.app/); assert.match(t.reply, /inspection is free/); assert.notEqual(t.state.status, 'booked'); });
test('20 USA is never a name', () => { assert.equal(validName('Usa'), false); const t = turn(withState({ question: 'name' }, { name: null }), 'USA 2019'); assert.equal(t.updates.name, undefined); });
test('21 no to a GCC-only question invokes Mulkiya check', () => { const t = turn(withState({ question: 'specs' }), 'No'); assert.equal(t.state.mulkiyaPending, true); assert.notEqual(t.state.status, 'closed'); });
test('22 two vehicle descriptions stay separate', () => { const t = turn(withState({}, { make: 'Hyundai', model: 'Sonata', year: '2021' }), 'I have one more car Camry model 2008 280k km'); assert.equal(t.state.vehicles[0].model, 'Sonata'); assert.equal(t.state.vehicles[0].year, '2021'); assert.equal(t.state.vehicles[1].model, 'Camry'); assert.equal(t.state.vehicles[1].year, '2008'); });
test('23 late loan correction asks balance', () => { const t = turn(base(), 'Yes loan is there'); assert.equal(t.updates.loan, 'Yes'); assert.equal(t.state.question, 'balance'); });
test('24 first greeting does not invent vehicle facts', () => { const t = turn(withState({}, { name: null, make: null, model: null, year: null }), 'Yes'); assert.equal(t.state.question, 'name'); assert.equal(t.confirm, undefined); });
test('25 US specs invokes verification', () => { const t = turn(base(), 'US spec'); assert.equal(t.state.mulkiyaPending, true); });
test('26 postponement invalidates previously firm appointment', () => { const t = turn(booked(), 'Okay I will inform you tomorrow'); assert.equal(t.state.status, 'reconfirmation'); assert.equal(t.updates.appointment_date, null); });
test('27 ordinal date is canonical and range does not become exact', () => { const t = turn(base(), '31st, morning 10 am to 2 pm'); assert.equal(t.state.proposedDate, '2026-10-31'); assert.equal(t.updates.appointment_time, null); });
test('28 known GCC is preserved on unrelated updates', () => { const t = turn(base(), 'Alex Smith'); assert.notEqual(t.updates.specs, 'Unknown'); });
test('29 German import requires verification without country inference', () => { const t = turn(base(), 'Audi Q7 2017, Germany import 180k km'); assert.equal(t.updates.specs, 'Unknown'); });
test('30 first greeting gets a name question', () => { const t = turn(withState({}, { name: null, make: null, model: null, year: null }), 'Hi'); assert.match(t.reply, /name/); });
test('31 location after callback does not reopen booking', () => { const t = turn(withState({ status: 'team_accepted', consent: 'accepted' }), 'Send me your location please'); assert.match(t.reply, /maps.app/); assert.doesNotMatch(t.reply, /which day|what time/i); });
test('32 model year mileage are recognised together', () => { const v = supportedVehicle('Corolla SE+\nModel Year 2017\n233000 km', {}); assert.equal(v.make, 'Toyota'); assert.equal(v.model, 'Corolla'); assert.equal(v.year, '2017'); assert.equal(v.mileage, '233000'); });
test('33 accepted proposed 18:30 stays valid and name cannot become finance', () => { assert.equal(validName('Under Finance'), false); const t = turn(withState({ status: 'awaiting_confirmation', question: 'confirm', proposedDate: '2026-10-24', proposedTime: '18:30' }), 'Yes'); assert.equal(t.state.status, 'booked'); assert.equal(t.updates.appointment_time, '18:30'); });
test('34 let me think changes booking status', () => { const t = turn(booked(), 'Let me think about it'); assert.equal(t.state.status, 'reconfirmation'); });
test('35 year-only answer asks only missing make and model', () => { const t = turn(withState({ question: 'vehicle' }, { make: null, model: null, year: null }), '2016'); assert.match(t.reply, /make and model/); assert.doesNotMatch(t.reply, /model and year/); });
test('36 yes to two choices does not fabricate a choice', () => { const t = turn(withState({ question: 'choice' }), 'Yes please'); assert.equal(t.state.question, 'choice'); assert.notEqual(t.state.status, 'booked'); assert.notEqual(t.state.consent, 'accepted'); });
test('37 departure time is not an arrival', () => { const t = turn(base(), "6pm I'll be leaving"); assert.match(t.reply, /arrive/); assert.equal(t.updates.appointment_time, null); });
test('38 will contact later closes callback loop', () => { const t = turn(base(), 'I will contact you later'); assert.equal(t.state.status, 'customer_will_contact'); assert.doesNotMatch(t.reply, /Would you like/); });
test('39 opening-only lead has no appointment', () => { const t = turn(withState({}, { name: null, make: null, model: null, year: null }), 'Hello'); assert.equal(t.updates.appointment_date, null); });
test('40 mileage is not an expected price', () => { assert.equal(expectedPrice('I want to sell\n100750 km\nGCC'), null); assert.equal(expectedPrice('I want 100750 km'), null); assert.equal(expectedPrice('I want 110k AED'), 110000); });

// Successful flows and negative cases protect the boundaries around the fixes.
let c = { phone: '971500000001', messages: [] };
for (const text of ['Hello', 'Alex Smith', 'Toyota Camry 2021 100000 km GCC', 'No', 'As soon as possible', 'Tomorrow 3pm']) {
  const t = turn(c, text); c = { ...c, ...t.updates, messages: [...c.messages, { role: 'user', content: text }, { role: 'assistant', content: t.reply }] };
}
assert.equal(c.flow_state.status, 'booked'); assert.equal(c.appointment_time, '15:00'); assert.equal(c.name, 'Alex Smith');
assert.equal(slotValid('2026-10-25', '15:00', now), false);
assert.equal(slotValid('2026-10-23', '11:30', now), false);
assert.equal(slotValid('2026-02-31', '15:00', now), false);
assert.equal(expectedPrice('Outstanding loan 90000 AED'), null);
assert.equal(expectedPrice('I want to sell 2021'), null);
assert.equal(inspectionBooked({ appointment_date: '2026-10-24', appointment_time: '15:00', messages: [] }), false);
assert.equal(supportedVehicle('Is this free?', {}).model, undefined);
assert.equal(supportedVehicle('Tomorrow at 3', {}).make, undefined);
assert.equal(supportedVehicle('seat cover prices', {}).make, undefined);
assert.equal(supportedVehicle('Year 2017\nKM 233000', {}).mileage, '233000');
assert.notEqual(turn(withState({}, { make: null, model: null }), 'Tomorrow 3pm').state.status, 'booked');
assert.equal(turn(booked(), 'Thanks').confirm, undefined);
console.log(`${cases} reviewed-chat regression cases plus successful booking, consent, factual and slot invariants passed.`);

if (process.argv[2]) {
  const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); let messages = 0, confirmations = 0;
  for (const row of rows) {
    let chat = { phone: 'offline', messages: [] };
    const clock = new Date(String(row.created_at).replace(' ', 'T') + 'Z');
    for (const input of row.messages.filter(m => m.role === 'user')) {
      const t = planTurn(chat, input.content, {}, clock); messages++;
      if (t.confirm) { assert.equal(slotValid(t.state.proposedDate, t.state.proposedTime, clock), true); confirmations++; }
      if (t.updates.name) assert.equal(validName(t.updates.name), true);
      if (t.state.status === 'customer_will_contact') assert.equal(t.state.consent, 'declined');
      chat = { ...chat, ...t.updates, messages: [...chat.messages, input, { role: 'assistant', content: t.reply }] };
    }
  }
  console.log(`Offline safety replay: ${rows.length} saved customer sequences, ${messages} customer turns, ${confirmations} guarded confirmations. No external services called.`);
}
module.exports = { load };
