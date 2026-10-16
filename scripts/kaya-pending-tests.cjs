const assert=require('node:assert/strict'),path=require('node:path');const dir=process.argv[2];
let enabled=true,lease=true,fail=false,calls=0,published=0,saved=[],released=0;
const run={id:'pending:test',summary:{phones:['971501234567','971509876543'],completed:[],errors:[]}};
const chat={phone:'971501234567',messages:[{role:'user',content:'location'},{role:'assistant',content:'Our branch is in Dubai'}]};
require.cache[require.resolve(path.join(dir,'approve.js'))]={exports:{autoReview:async(c,f,key)=>{assert.equal(key,run.id);calls++;if(fail)throw Error('Provider timeout');}}};
require.cache[require.resolve(path.join(dir,'publisher.js'))]={exports:{publishReady:async options=>{assert.equal(options.processNow,true);published++;}}};
require.cache[require.resolve(path.join(dir,'store.js'))]={exports:{settings:async()=>({config:{enabled,autoApprove:true}}),improveDb:()=>({rpc:async(n,args)=>{if(args.release_lease)released++;return{data:lease}},from:table=>{
 let update;const q={select(){return q},eq(){return q},order(){return q},limit(){return Promise.resolve({data:[run]})},single(){return Promise.resolve({data:chat})},update(v){update=v;return q},then(resolve){if(update){saved.push(update);Object.assign(run,update)}return Promise.resolve({error:null}).then(resolve)}};return q;
}})}};
const {pendingPhones,processPendingReviews}=require(path.join(dir,'pending.js'));
(async()=>{
 const proposals=[{evidence:{conversation:chat.messages}},{evidence:{phone:'971509876543'}},{evidence:{phone:'971599900001'}},{evidence:{phone:'invalid'}}];
 assert.deepEqual(pendingPhones(proposals,[{phone:chat.phone,findings:[{}]},{phone:'971508888888',findings:[]}],[chat]),['971501234567','971509876543']);
 assert.deepEqual(pendingPhones([{evidence:{conversation:[{role:'user',content:'unrelated'}]}}],[],[chat]),[]);
 enabled=false;assert.equal((await processPendingReviews()).paused,true);assert.equal(calls,0);
 enabled=true;lease=false;assert.equal((await processPendingReviews()).busy,true);assert.equal(calls,0);
 lease=true;let result=await processPendingReviews();assert.equal(result.remaining,1);assert.equal(published,0);assert.equal(saved.at(-1).status,'running');assert.equal(released,1);
 fail=true;result=await processPendingReviews();assert.equal(result.remaining,0);assert.equal(result.errors,1);assert.equal(saved.at(-1).status,'failed');assert.equal(published,1);assert.equal(released,2);
 console.log('Pending reviews preserve a durable cursor, isolate failed sources, honor stop/lease controls and only expedite after the queue drains.');
})().catch(e=>{console.error(e);process.exitCode=1});
