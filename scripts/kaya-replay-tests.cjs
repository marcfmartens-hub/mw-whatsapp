const assert=require('node:assert/strict'),path=require('node:path');const dir=process.argv[2];let mode='pass',enabled=true;
require.cache[require.resolve(path.join(dir,'store.js'))]={exports:{settings:async()=>({config:{enabled,autoApprove:true}})}};
require.cache[require.resolve(path.join(dir,'..','claude.js'))]={exports:{getKayaReply:async(_s,_h,_m,_k,l)=>l.skills?.length?'Improved reply':'Baseline reply'}};
require.cache[require.resolve(path.join(dir,'reviewer.js'))]={exports:{jsonReview:async(_s,pairs)=>({cases:mode==='missing'?[]:pairs.map((p,index)=>({index,before_score:2,after_score:mode==='worse'?1:mode==='same'?2:3,rules_preserved:mode!=='policy',observed_problem_fixed:true,reason:'test'}))})}};
const {replayGate}=require(path.join(dir,'replay.js'));
const before={version:1,aliases:[]},after={...before,skills:['avoid_repetition']},input={label:'Observed issue',message:'I already told you',history:[],step:1,known:{}};
(async()=>{
 assert.equal((await replayGate(before,after,[input],[{...input,label:'Successful chat'}])).passed,true);
 for(mode of ['missing','worse','same','policy'])await assert.rejects(replayGate(before,after,[input],[input]));
 mode='pass';await assert.rejects(replayGate(before,after,[input],[]),/Successful-chat/);
 enabled=false;await assert.rejects(replayGate(before,after,[input],[input]),/switched off/);
 console.log('Before/after replay blocks missing results, worse responses, no demonstrated improvement, locked-rule failures, absent successful examples and disabled automation.');
})().catch(e=>{console.error(e);process.exitCode=1});
