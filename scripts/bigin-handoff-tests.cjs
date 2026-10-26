const fs=require('fs'),ts=require('typescript'),Module=require('module'),assert=require('assert/strict');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const original=Module._load;let record,accepted=false,writes=[];
Module._load=function(id,parent,...rest){
 if(parent?.filename.endsWith('bigin-outcome.ts')){
  if(id==='./supabase')return {getConversation:async()=>record,updateConversation:async(_,patch)=>{writes.push(patch);record={...record,...patch};return record;}};
  if(id==='./bigin')return {toIsoDate:v=>v,toTime24:v=>v,createBiginContact:async p=>{if(accepted)p.bigin_sync_result={contactId:'c1',pipelineId:'p1',stage:'Call Back'};return accepted;}};
 }
 if(parent?.filename.endsWith('bigin-reconcile.ts')){
  if(id==='./supabase')return {};
  if(id==='./bigin-outcome')return {};
  if(id==='./conversation-state')return {inspectionBooked:c=>c.flow_state?.status==='booked'};
 }
 return original.call(this,id,parent,...rest);
};
const {plusPhone}=require('../lib/phone.ts');
for(const [input,expected]of [['971 50 123 4567','+971501234567'],['+971501234567','+971501234567'],['44 7700 900123','+447700900123'],['+1 (202) 555-0123','+12025550123'],['','']])assert.equal(plusPhone(input),expected);
const {ensureBiginPipeline}=require('../lib/bigin-pipeline.ts');
const {syncBiginOutcome}=require('../lib/bigin-outcome.ts');
const {dueBiginOutcome}=require('../lib/bigin-reconcile.ts');
const now=Date.now();const lead={phone:'971501234567',messages:[{role:'user',content:'Hello'}],last_message_at:new Date(now-15*60000).toISOString(),flow_state:{status:'collecting'}};
assert.equal(dueBiginOutcome(lead,now),'callback');assert.equal(dueBiginOutcome({...lead,last_message_at:new Date(now-14*60000).toISOString()},now),null);
assert.equal(dueBiginOutcome({...lead,last_message_at:new Date(now).toISOString(),flow_state:{status:'team_accepted'}},now),'callback');
assert.equal(dueBiginOutcome({...lead,flow_state:{status:'booked'}},now),'booked');
assert.equal(dueBiginOutcome({...lead,flow_state:{status:'collecting',consent:'declined'}},now),null);
assert.equal(dueBiginOutcome({...lead,flow_state:{status:'team_accepted',biginSync:{outcome:'callback',pending:false,syncedAt:new Date(now).toISOString()}}},now),null);
assert.equal(dueBiginOutcome({...lead,appointment_date:'2026-10-26',appointment_time:'13:00',flow_state:{status:'team_accepted',autoCallback:true},messages:[{role:'user',content:'yes'},{role:'assistant',content:'Your free inspection is confirmed for Monday.'}]},now),'booked');
assert.equal(dueBiginOutcome({...lead,flow_state:{status:'team_accepted',biginSync:{pending:true,runningUntil:new Date(now+60000).toISOString()}}},now),null);
let saved=null,posts=0,puts=0,failWrite=false,badRead=false;
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
global.fetch=async(url,opts={})=>{
 if(url.includes('settings/layouts'))return response({layouts:[{id:'team1',name:'WhatsApp',sections:[{fields:[{api_name:'Sub_Pipeline',pick_list_values:[{actual_value:'WhatsApp Standard',maps:[{api_name:'Stage',pick_list_values:[{actual_value:'Call Back'},{actual_value:'Booking'}]}]}]}]}]}]});
 if(url.includes('/Contacts/c1/Pipelines')){assert.ok(url.includes('pipeline_id=team1'));return response({data:saved?[{...saved,Created_Time:'2026-10-25'}]:[]});}
 if(url.endsWith('/Pipelines')){
  if(failWrite)return response({data:[{status:'error'}]},403);
  const p=JSON.parse(opts.body);assert.deepEqual(p.trigger,[]);assert.equal(p.data[0].Contact_Name.id,'c1');assert.equal(p.data[0].Phone_Number,'+971501234567');assert.equal(p.data[0].Conversation_Phone_Number,'+971501234567');
  if(opts.method==='POST')posts++;else puts++;
  saved={...p.data[0],id:'p1'};return response({data:[{status:'success',details:{id:'p1'}}]});
 }
 if(url.includes('/Pipelines/p1?'))return response({data:[{...saved,Stage:badRead?'Wrong':saved.Stage}]});
 throw Error('Unexpected URL '+url);
};
(async()=>{
 let result=await ensureBiginPipeline('c1',{...lead,bigin_outcome:'callback'},'not-a-real-token');assert.equal(result.pipelineId,'p1');assert.equal(posts,1);
 await ensureBiginPipeline('c1',{...lead,bigin_outcome:'callback'},'not-a-real-token');assert.equal(posts,1);assert.equal(puts,1);
 result=await ensureBiginPipeline('c1',{...lead,bigin_outcome:'booked',appointment_date:'2026-10-26',appointment_time:'13:00'},'not-a-real-token');assert.equal(result.stage,'Booking');assert.equal(saved.Appointment_Date_and_Time,'2026-10-26T13:00:00+04:00');
 saved.Stage='Lost | Stage 1';
 const previousWrites=posts+puts;
 const kept=await ensureBiginPipeline('c1',{...lead,bigin_outcome:'callback',preserve_staff_stage:true},'not-a-real-token');assert.equal(kept.stage,'Lost | Stage 1');assert.equal(posts+puts,previousWrites);
 const beforeFresh=posts;
 const fresh=await ensureBiginPipeline('c1',{...lead,bigin_outcome:'callback'},'not-a-real-token');assert.equal(fresh.stage,'Call Back');assert.equal(posts,beforeFresh+1);
 failWrite=true;await assert.rejects(()=>ensureBiginPipeline('c1',{...lead,bigin_outcome:'callback'},'not-a-real-token'),/write failed/);failWrite=false;
 badRead=true;await assert.rejects(()=>ensureBiginPipeline('c1',{...lead,bigin_outcome:'callback'},'not-a-real-token'),/read-back/);badRead=false;
 record={...lead,flow_state:{status:'team_accepted'}};writes=[];accepted=false;
 assert.equal(await syncBiginOutcome(record,'callback'),false);assert.equal(record.bigin_pushed_at,undefined);assert.equal(record.flow_state.biginSync.pending,true);
 accepted=true;assert.equal(await syncBiginOutcome(record,'callback'),true);assert.ok(record.bigin_pushed_at);assert.equal(record.flow_state.biginSync.pending,false);assert.equal(record.flow_state.biginSync.pipelineId,'p1');
 console.log('Bigin handoff checks passed: 15-minute cutoff, immediate callbacks, idempotent v2 cards, appointment read-back, write/read failures and success-marker safety');
})().catch(e=>{console.error(e);process.exitCode=1;});
