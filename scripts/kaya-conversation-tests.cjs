const assert=require('node:assert/strict'),path=require('node:path');const dir=process.argv[2];
const {DEFAULT_CONFIG}=require(path.join(dir,'config.js'));let current={...DEFAULT_CONFIG,enabled:true,autoApprove:true},calls=[],events=0;
const chain={select(){return this},eq(){return this},order(){return this},async limit(){return{data:[],error:null}}};
require.cache[require.resolve(path.join(dir,'store.js'))]={exports:{settings:async()=>({config:current}),improveDb:()=>({from:()=>Object.create(chain)})}};
require.cache[require.resolve(path.join(dir,'runner.js'))]={exports:{runCheck:async(...a)=>calls.push(a)}};
global.fetch=async()=>{events++;return{ok:true}};
process.env.VERCEL_ENV='production';const {afterConversationSave}=require(path.join(dir,'events.js'));
(async()=>{
 const chat={phone:'971500000001',messages:[{role:'user',content:'where ur branch'},{role:'assistant',content:'We are in Al Quoz'}]};
 await afterConversationSave(chat);assert.deepEqual(calls.map(c=>c[0]),['reply','outcome','review','regression']);assert.equal(events,1);assert.equal(calls.every(c=>c[1]==='conversation'),true);
 calls=[];current={...current,enabled:false};await afterConversationSave(chat);assert.equal(calls.length,0);assert.equal(events,1);
 current={...current,enabled:true};await afterConversationSave({...chat,messages:[{role:'user',content:'Hi'}]});assert.equal(events,1);
 process.env.VERCEL_ENV='preview';await afterConversationSave(chat);assert.equal(events,1);
 console.log('Every saved reply triggers review without a Bigin push; disabled system, user-only saves and preview are isolated.');
})().catch(e=>{console.error(e);process.exitCode=1});
