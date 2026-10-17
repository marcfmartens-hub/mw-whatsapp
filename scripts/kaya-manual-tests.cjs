const assert=require('node:assert/strict'),path=require('node:path');
const dir=process.argv[2];let proposal,enabled=true,independent=true,replayPass=true,saved=[];
const chat={phone:'971501234567',messages:[{role:'user',content:'where is your branch'}]};
const db={from(table){let update,filters=[];const q={select(){return q},eq(k,v){filters.push([k,v]);return q},is(){return q},update(v){update=v;return q},async single(){return {data:table==='mw_whatsapp'?chat:proposal}},then(resolve){if(update)saved.push(update);return Promise.resolve({data:[{id:'p'}],error:null}).then(resolve)}};return q}};
require.cache[require.resolve(path.join(dir,'store.js'))]={exports:{settings:async()=>({config:{enabled,autoApprove:true}}),improveDb:()=>db}};
require.cache[require.resolve(path.join(dir,'reviewer.js'))]={exports:{independentlyValidate:async()=>({passed:independent,reason:'test'}),normalizePhrase:s=>s}};
require.cache[require.resolve(path.join(dir,'publisher.js'))]={exports:{successfulMessages:async()=>[],hash:s=>s}};
require.cache[require.resolve(path.join(dir,'replay.js'))]={exports:{replayInput:()=>({source:true}),successfulReplayInputs:async()=>[],replayGate:async()=>{if(!replayPass)throw Error('Replay failed');return {passed:true}}}};
const {approveProposal}=require(path.join(dir,'approve.js'));
(async()=>{
 const base={id:'p',status:'needs_admin',intent:'request_location',phrase:'where is your branch',evidence:{phone:chat.phone}};
 proposal={...base,intent:null,phrase:null};await assert.rejects(()=>approveProposal('p','marc'),/no executable fix/);assert.equal(saved.length,0);
 proposal={...base,release_id:'r'};await assert.rejects(()=>approveProposal('p','marc'),/changed/);
 proposal={...base};enabled=false;await assert.rejects(()=>approveProposal('p','marc'),/Enable/);enabled=true;
 independent=false;await assert.rejects(()=>approveProposal('p','marc'),/Independent/);assert.equal(saved.length,0);independent=true;
 replayPass=false;await assert.rejects(()=>approveProposal('p','marc'),/Replay/);assert.equal(saved.length,0);replayPass=true;
 await approveProposal('p','marc');assert.equal(saved.length,1);assert.equal(saved[0].status,'approved');assert.equal(saved[0].validation.approved_by,'marc');assert.equal(saved[0].validation.replay_source.source,true);
 console.log('Manual approval preserves stop/release guards, requires an executable fix, independent validation and replay; records actor and replay evidence.');
})().catch(e=>{console.error(e);process.exitCode=1});
