const assert = require('node:assert/strict');
const { load } = require('./kaya-integrity-tests.cjs');
let row, failSend = false, failCrm = false, failTask = false, missingSchema = false, sent = [], pushes = [], slot = '14:15';
const mocks = {
  '@/lib/supabase': {
    getConversation: async () => structuredClone(row),
    updateConversation: async (_, patch) => { Object.assign(row, structuredClone(patch)); if (missingSchema) delete row.flow_state; return structuredClone(row); },
  },
  '@/lib/claude': { extractVehicleInfo: async () => ({}), generateInquirySummary: async () => 'Summary' },
  '@/lib/meta': { sendWhatsAppMessage: async (_, reply) => { if (failSend) throw Error('Meta rejected reply'); sent.push(reply); } },
  '@/lib/bigin': { createBiginContact: async c => { pushes.push(c); return !failCrm; }, createChangeTask: async () => ({ ok: !failTask }), moveLeadToCallBack: async () => {} },
  '@/lib/slots': { pickDefaultTime: async () => slot },
};
const { handleConversationTurn, chooseDefault } = load('lib/conversation-turn.ts', mocks);
const reset = () => {
  const tomorrow = new Date(Date.now() + 28 * 3600e3); if (tomorrow.getUTCDay() === 0) tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  row = { phone: '971500000001', name: 'Alex', make: 'Toyota', model: 'Camry', year: '2021', mileage: '100000', specs: 'GCC', loan: 'No', sell_timeline: 'Soon', messages: [{ role: 'user', content: '3pm' }], flow_state: { version: 1, status: 'visit_proposed', question: 'exact_time', proposedDate: tomorrow.toISOString().slice(0, 10) } };
  failSend = failCrm = failTask = missingSchema = false; sent = []; pushes = [];
};
(async () => {
  reset(); failSend = true;
  await assert.rejects(handleConversationTurn(structuredClone(row), '3pm'));
  assert.equal(row.flow_state.status, 'awaiting_confirmation'); assert.equal(row.appointment_date, null); assert.equal(pushes.length, 0);
  assert.equal(row.messages.some(m => m.role === 'assistant'), false);
  reset(); missingSchema = true;
  await assert.rejects(handleConversationTurn(structuredClone(row), '3pm'), /schema/); assert.equal(sent.length, 0);
  reset(); await handleConversationTurn(structuredClone(row), '3pm');
  assert.equal(row.flow_state.status, 'booked'); assert.equal(row.appointment_time, '15:00'); assert.equal(sent.length, 1);
  assert.equal(pushes[0].inspection_booked, true); assert.ok(row.bigin_pushed_at);
  assert.equal(row.messages.filter(m => m.role === 'user').length, 1, 'inbound must not be appended twice');
  reset(); failCrm = true; await handleConversationTurn(structuredClone(row), '3pm');
  assert.equal(row.flow_state.status, 'booked'); assert.equal(row.bigin_pushed_at, undefined, 'CRM failures remain retryable');
  reset(); row.appointment_date = row.flow_state.proposedDate; row.appointment_time = '15:00'; row.flow_state.status = 'booked'; failTask = true;
  await handleConversationTurn(structuredClone(row), 'Let me think about it');
  assert.equal(row.flow_state.status, 'reconfirmation'); assert.equal(row.appointment_date, null); assert.ok(row.flow_state.pendingTask);
  assert.equal(row.bigin_pushed_at, undefined);
  const state = { version: 1, status: 'visit_proposed', question: 'exact_time', proposedDate: '2026-10-24', timeMin: 600, timeMax: 720 };
  const t = { state, updates: {}, reply: '', defaultDate: state.proposedDate };
  await chooseDefault(t, 'test', new Date('2026-10-23T08:00:00Z'));
  assert.notEqual(state.status, 'default_pending', 'default must stay inside the agreed time window');
  delete state.timeMin; delete state.timeMax;
  await chooseDefault(t, 'test', new Date('2026-10-23T08:00:00Z'));
  assert.equal(state.status, 'default_pending'); assert.equal(t.updates.appointment_date, null);
  assert.match(t.reply, /call centre will confirm/);
  console.log('Delivery/schema failures, successful booking, CRM/task retries, history preservation and default-slot boundary integration checks passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
