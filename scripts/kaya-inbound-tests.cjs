const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function load(file, mocks = {}) {
  const filename = path.resolve(file);
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)(id => {
    if (id in mocks) return mocks[id];
    if (id.startsWith('@/')) return load(id.slice(2) + '.ts', mocks);
    if (id.startsWith('.')) {
      const target = path.resolve(path.dirname(filename), id);
      if (fs.existsSync(target + '.ts')) return load(target + '.ts', mocks);
      return require(target);
    }
    return require(id);
  }, module, module.exports);
  return module.exports;
}
(async () => {
  const { saveInbound } = load('lib/inbound.ts');
  let row = { phone: 'test', step: 0, messages: [] };
  const read = async () => structuredClone(row);
  const write = async (_, updates) => Object.assign(row, updates);
  const before = await saveInbound('test', 'one', 'Hello', read, write);
  assert.equal(before.before.messages.length, 0);
  // An outbound authentication failure cannot erase an already committed inbound.
  await assert.rejects(async () => { throw Error('Meta 401'); });
  assert.equal(row.messages[0].content, 'Hello');
  assert.ok(row.last_message_at);
  assert.equal(row.phone_number, 'test');
  assert.equal(row.step, 0);
  assert.equal((await saveInbound('test', 'one', 'Hello', read, write)).duplicate, true);
  assert.equal(row.messages.length, 1);
  await saveInbound('test', 'two', 'Hello', read, write);
  assert.equal(row.messages.length, 2, 'separate message IDs retain repeated text');
  await assert.rejects(saveInbound('test', 'three', 'New', read, async () => { throw Error('DB unavailable'); }));

  let webhookRow = { phone: 'test', step: 0, messages: [] }, attempts = 0;
  const webhook = load('app/api/webhook/route.ts', {
    '@/lib/supabase': {
      getOrCreateConversation: async () => structuredClone(webhookRow),
      updateConversation: async (_, updates) => Object.assign(webhookRow, updates),
      getConversation: async () => structuredClone(webhookRow),
    },
    '@/lib/meta': { sendWhatsAppMessage: async () => { attempts++; throw Error('Meta 401'); } },
    '@/lib/claude': {}, '@/lib/bigin': {}, '@/lib/valuation': {},
  });
  const post = message => webhook.POST({ json: async () => ({ entry: [{ changes: [{ value: { messages: [{ from: 'test', ...message }] } }] }] }) });
  await post({ id: 'audio1', type: 'audio' });
  assert.equal(webhookRow.messages[0].content, '[audio]');
  assert.ok(webhookRow.last_message_at);
  assert.equal(webhookRow.messages.some(m => m.role === 'assistant'), false);
  const duplicate = await post({ id: 'audio1', type: 'audio' });
  assert.equal((await duplicate.json()).status, 'duplicate');
  assert.equal(attempts, 1);
  await post({ id: 'text1', type: 'text', text: { body: 'مرحبا' } });
  assert.equal(webhookRow.messages.at(-1).content, 'مرحبا');
  assert.equal(attempts, 2);

  let candidates = [], legacy = [], accepted = [], marks = [], sends = 0, rejectBigin = false, markError = false;
  const chain = () => {
    let isLegacy = false, updates;
    const q = {
      select() { return q; }, lt() { return q; }, gt() { return q; }, order() { return q; },
      is(k) { if (k === 'last_message_at') isLegacy = true; return q; },
      update(value) { updates = value; return q; },
      eq(k, v) { if (updates) { marks.push([v, updates]); return Promise.resolve({error: markError ? Error('write failed') : null}); } return q; },
      limit() { return Promise.resolve({ data: structuredClone(isLegacy ? legacy : candidates), error: null }); },
    }; return q;
  };
  const { pushInactive } = load('lib/inactive-leads.ts', {
    '@supabase/supabase-js': { createClient: () => ({ from: chain }) },
    '@/lib/bigin': { createBiginContact: async c => { accepted.push(c); return !rejectBigin; }, moveLeadToCallBack: async () => {} },
    '@/lib/slots': { pickDefaultTime: async () => '16:15' },
    '@/lib/meta': { sendWhatsAppMessage: async () => { sends++; throw Error('Meta 401'); } },
    '@/lib/claude': { generateInquirySummary: async () => 'Customer inquiry' },
    './conversation-turn': { chooseDefault: async turn => { turn.state.status = 'default_pending'; turn.state.proposedTime = '16:15'; turn.updates.flow_state = turn.state; turn.reply = 'Selected default slot; call centre confirmation pending'; } },
  });
  process.env.SUPABASE_URL = 'https://example.invalid'; process.env.SUPABASE_ANON_KEY = 'test';
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  candidates = [{ phone: '971500000001', step: 0, last_message_at: yesterday, messages: [{ role: 'user', content: 'Hi' }] }];
  legacy = [{ phone: '971500000002', step: 0, last_message_at: null, messages: [{ role: 'user', content: 'My Toyota is for sale' }] }];
  legacy.push({ phone: 'stress_test', step: 0, last_message_at: null, messages: [{ role: 'user', content: 'test' }] });
  legacy.push({ phone: '971500000004', step: 0, last_message_at: null, messages: [] });
  assert.deepEqual(await pushInactive(true), { pushed: 2, total: 2, failed: 0 });
  assert.equal(sends, 0); assert.equal(marks.length, 2);
  assert.equal(accepted[1].phone_number, '971500000002');
  assert.match(accepted[1].inquiry_summary, /Recovered stalled WhatsApp inquiry/);
  assert.equal(accepted[1].inspection_booked, false);

  // Failed booking message must not prevent CRM forwarding or fabricate a booking.
  let bookingDay = new Date(Date.now() + 3 * 86400000);
  if (bookingDay.getUTCDay() === 0) bookingDay = new Date(+bookingDay + 86400000);
  candidates = [{ phone: '971500000003', step: 7, last_message_at: yesterday, flow_state: { version: 1, status: 'visit_proposed', question: 'exact_time', proposedDate: bookingDay.toISOString().slice(0, 10) }, messages: [{ role: 'assistant', content: 'What exact time would you prefer on that day?' }] }]; legacy = []; accepted = []; marks = [];
  assert.equal((await pushInactive()).pushed, 1);
  assert.equal(sends, 1); assert.equal(accepted[0].inspection_booked, false);
  assert.equal(accepted[0].appointment_time, undefined);
  rejectBigin = true; marks = [];
  assert.equal((await pushInactive(true)).failed, 1);
  assert.equal(marks.length, 0, 'rejected CRM writes remain eligible for retry');
  rejectBigin = false; markError = true;
  assert.equal((await pushInactive(true)).failed, 1, 'failed bookkeeping is not reported as success');
  console.log('Inbound durability, deduplication, step-zero/legacy recovery, Meta failure isolation and CRM retry tests passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
