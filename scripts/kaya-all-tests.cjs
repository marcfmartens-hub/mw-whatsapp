const assert=require('node:assert/strict'),path=require('node:path');
const dir=process.argv[2];let enabled=true,full=true,lease=true,failure='',calls=0,published=0,updates=[];
const run={id:'all:test',summary:{ids:['p1','p2'],actor:'marc',automatic:false,completed:[],blocked:[],errors:[]}};
let proposal={id:'p1',status:'rejected',intent:'request_location',phrase:'where are you',evidence:{phone:'971501234567'}};
require.cache[require.resolve(path.join(dir,'approve.js'))]={exports:{approveProposal:async()=>{calls++;if(failure)throw Error(failure)},autoReview:async()=>{calls++}}};
require.cache[require.resolve(path.join(dir,'publisher.js'))]={exports:{publishReady:async()=>{published++}}};
require.cache[require.resolve(path.join(dir,'store.js'))]={exports:{settings:async()=>({config:{enabled,autoApprove:true,fullAutonomous:full}}),improveDb:()=>({rpc:async()=>({data:lease}),from(table){let update;const q={select(){return q},eq(){return q},is(){return q},in(){return q},order(){return q},limit(){return Promise.resolve({data:[run]})},single(){return Promise.resolve({data:proposal})},update(v){update=v;return q},then(resolve){if(update){updates.push({table,update});if(table==='mw_improve_runs')Object.assign(run,update)}return Promise.resolve({error:null,data:[]}).then(resolve)}};return q}})}};
const {processAllProposals}=require(path.join(dir,'all-proposals.js'));
(async()=>{
 enabled=false;assert.equal((await processAllProposals()).paused,true);assert.equal(calls,0);enabled=true;
 lease=false;assert.equal((await processAllProposals()).busy,true);lease=true;
 run.summary.automatic=true;full=false;assert.equal((await processAllProposals()).paused,true);assert.equal(calls,0);run.summary.automatic=false;
 failure='Provider timeout';assert.equal((await processAllProposals()).retrying,'p1');assert.equal(run.summary.ids.length,2);assert.equal(updates.some(x=>x.table==='mw_improve_proposals'),false);
 failure='Replay failed';let result=await processAllProposals();assert.equal(result.remaining,1);assert.equal(result.blocked,1);assert.equal(updates.find(x=>x.table==='mw_improve_proposals').update.status,'rejected');
 failure='';proposal={...proposal,id:'p2'};result=await processAllProposals();assert.equal(result.remaining,0);assert.equal(result.completed,1);assert.equal(run.status,'completed');assert.equal(published,2);
 console.log('Approve All preserves stop/lease controls, pauses automatic queues, retries transient errors without approving, isolates failed tests, continues other proposals and publishes passing fixes.');
})().catch(e=>{console.error(e);process.exitCode=1});
