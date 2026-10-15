const assert=require('node:assert/strict'),path=require('node:path');
const dir=process.argv[2];let enabled=true,checks=0,rows=[],writes=[];
const chain={select(){return this},not(){return this},order(){return this},limit(n){this.n=n;return this},insert(v){writes.push(v);return Promise.resolve({error:null})},upsert(v){writes.push(v);return Promise.resolve({error:null})},update(v){writes.push(v);return this},eq(){return this},then(resolve,reject){return Promise.resolve({data:rows.slice(0,this.n),error:null}).then(resolve,reject)}};
require.cache[require.resolve(path.join(dir,'store.js'))]={exports:{settings:async()=>({config:{enabled:enabled && (++checks<99)}}),improveDb:()=>({from:()=>Object.create(chain)})}};
const {recentChatLimit,analyzeRecentChats}=require(path.join(dir,'runner.js'));
(async()=>{
 for(const n of [1,2,5,10,100])assert.equal(recentChatLimit(n),n);
 for(const n of [0,-1,101,1.5,'10',null])assert.throws(()=>recentChatLimit(n));
 enabled=false;await assert.rejects(analyzeRecentChats(2),/switched off/);assert.equal(writes.length,0);
 enabled=true;rows=[1,2,3].map(n=>({phone:`97150000000${n}`,messages:[{role:'user',content:'No thanks'}]}));
 const result=await analyzeRecentChats(2);assert.equal(result.checked,2);assert.equal(result.results.length,2);assert.equal(result.results[0].outcome,'not_ready');assert.equal(writes.filter(w=>w.phone).length,2);assert.equal(writes.some(w=>w.status==='completed'),true);assert.equal(writes.some(w=>'booking_verified' in w),false);
 console.log('Recent-chat count validation, master stop, selected count and report persistence passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
