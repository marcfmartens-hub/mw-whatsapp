const assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');const dir=process.argv[2];
let enabled=true,confirmed=false,pauses=[],restores=[];const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const before='{"version":1,"aliases":[]}',after='{"version":1,"aliases":[],"skills":["avoid_repetition"]}';
const release={id:'release',published_at:'2026-10-15T10:00:00Z',backup:{before,after,before_hash:hash(before),after_hash:hash(after)}};
const chain={select(){return this},eq(){return this},is(){return this},order(){return this},limit(){return Promise.resolve({data:[release],error:null})},upsert(){return Promise.resolve({error:null})}};
require.cache[require.resolve(path.join(dir,'store.js'))]={exports:{settings:async()=>({revision:1,config:{enabled,autoApprove:true}}),improveDb:()=>({from:()=>Object.create(chain),rpc:async(_n,v)=>{pauses.push(v);return{error:null}}})}};
require.cache[require.resolve(path.join(dir,'publisher.js'))]={exports:{hash,rollbackRelease:async(...a)=>restores.push(a)}};
require.cache[require.resolve(path.join(dir,'replay.js'))]={exports:{replayInput:()=>({history:[],message:'im call you',known:{},step:7})}};
require.cache[require.resolve(path.join(dir,'..','claude.js'))]={exports:{getKayaReply:async()=>"You can call us"}};
require.cache[require.resolve(path.join(dir,'reviewer.js'))]={exports:{jsonReview:async()=>({critical_regression:confirmed,baseline_rules_preserved:true,reason:'Reversed callback direction'}),safeEvidence:c=>c.messages}};
require.cache[require.resolve(path.join(dir,'github.js'))]={exports:{Github:class{async main(){return{sha:'main'}}async file(){return after}}}};
const {watchDeployedLearning}=require(path.join(dir,'watch.js'));
const chat={phone:'971500000001',last_message_at:'2026-10-15T11:00:00Z',messages:[{role:'user',content:'im call you'},{role:'assistant',content:'Our team will call you tomorrow'}]};
(async()=>{
 assert.equal(await watchDeployedLearning(chat),false);assert.equal(pauses.length,0);
 confirmed=true;assert.equal(await watchDeployedLearning({...chat,last_message_at:'2026-10-14T10:00:00Z'}),false);assert.equal(pauses.length,0);assert.equal(await watchDeployedLearning(chat),true);assert.equal(pauses[0].next_config.autoApprove,false);assert.equal(restores.length,1);
 enabled=false;await watchDeployedLearning(chat);assert.equal(pauses.length,1);assert.equal(restores.length,1);
 console.log('Production watch requires independent regression confirmation and matching deployed backup, then pauses publishing and prepares recovery; master off prevents action.');
})().catch(e=>{console.error(e);process.exitCode=1});
