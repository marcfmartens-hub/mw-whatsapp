const assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const dir=process.argv[2];let enabled=true,writes=[],focus=null;
const chain={insert(v){writes.push(v);return Promise.resolve({error:null})},upsert(v){writes.push(v);return Promise.resolve({error:null})},update(v){writes.push(v);return this},select(){return this},eq(){return this},maybeSingle(){return Promise.resolve({data:null,error:null})},then(r,j){return Promise.resolve({error:null}).then(r,j)}};
require.cache[require.resolve(path.join(dir,'store.js'))]={exports:{settings:async()=>({config:{enabled,autoApprove:true}}),improveDb:()=>({from:()=>Object.create(chain),rpc:async()=>({data:true,error:null})})}};
require.cache[require.resolve(path.join(dir,'publisher.js'))]={exports:{hash:s=>crypto.createHash('sha256').update(s).digest('hex'),publishReady:async()=>{},successfulMessages:async()=>[]}};
require.cache[require.resolve(path.join(dir,'reviewer.js'))]={exports:{safeEvidence:c=>c.messages,propose:async(c,f)=>{focus=f;return[]},independentlyValidate:async()=>({passed:true})}};
const {autoReview}=require(path.join(dir,'approve.js'));
const chat={phone:'971500000001',messages:[{role:'assistant',content:'Please tell me which car you want to sell.'},{role:'assistant',content:'Please tell me which car you want to sell.'}]};
(async()=>{
 await assert.rejects(autoReview(chat,'nonexistent'),/no longer applies/);assert.equal(writes.length,0);
 enabled=false;await autoReview(chat,'repeated_reply');assert.equal(writes.length,0);
 enabled=true;await autoReview(chat,'repeated_reply');assert.equal(focus,'repeated_reply');assert.ok(writes.some(w=>w.status==='needs_admin'&&w.evidence.code==='repeated_reply'));assert.ok(writes.some(w=>w.summary?.finding_code==='repeated_reply'&&w.summary.needs_admin===1));
 console.log('Focused finding reviews reject stale findings, respect master stop, and record unsupported fixes without publishing.');
})().catch(e=>{console.error(e);process.exitCode=1});
