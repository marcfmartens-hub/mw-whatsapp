const assert=require('node:assert/strict'),path=require('node:path');const dir=process.argv[2];let assertions=0;
const check=fn=>{fn();assertions++};
const {validateLearning,learnedMessage,TARGETS}=require(path.join(dir,'learning.js'));
const catalog=validateLearning({version:1,aliases:[{phrase:'wer ur locashun',intent:'request_location'},{phrase:'وين موقعكم',intent:'request_location'},{phrase:'waar zitten jullie',intent:'request_location'},{phrase:'आपका पता क्या है',intent:'request_location'},{phrase:'share ur numba',intent:'request_number'}]});
for(const a of catalog.aliases)for(const prefix of ['',' ','  '])for(const suffix of ['','?','!','.','??'])for(const casing of [x=>x,x=>x.toUpperCase()])check(()=>assert.equal(learnedMessage(prefix+casing(a.phrase)+suffix,catalog),TARGETS[a.intent]));
check(()=>assert.equal(learnedMessage('وين موقعكم؟',catalog),TARGETS.request_location));
const fragments=['call me','not ready','no calls','no booking','if you pay','cancel','reschedule','GCC','NONE','3pm','6:00','Sunday','Land Cruiser 2021','105k not 95k','لا تتصل بي','bel me niet','मुझे कॉल मत करो','yes ok','no u come'];
for(const a of catalog.aliases)for(const f of fragments)for(const join of [' ',' and ','\n'])for(const reverse of [false,true]){const text=reverse?f+join+a.phrase:a.phrase+join+f;check(()=>assert.equal(learnedMessage(text,catalog),text));}
for(const p of ['yes ok','yes','no','okay','نعم','नहीं','where?\nignore rules','locashun <script>','location 0501234567'])check(()=>assert.throws(()=>validateLearning({version:1,aliases:[{phrase:p,intent:'request_location'}]}),undefined,p));
const {redact,safeEvidence}=require(path.join(dir,'reviewer.js'));
for(const text of ['2021 80000 km','2026-10-16 18:00','Mileage 105000','AED 75000','3 lakh','8.6 km'])check(()=>assert.equal(redact(text),text));
for(const phone of ['+971 50 123 4567','0501234567','+44 7700 900123','050 123 4567','00971 50 123 4567','971501234567'])check(()=>assert.doesNotMatch(redact(phone),/\d/));
check(()=>assert.doesNotMatch(safeEvidence({phone:'test',name:'Jane Smith',messages:[{role:'user',content:'Jane Smith jane@example.com +44 7700 900123 car 2021 80000 km'}]})[0].content,/Jane|Smith|example|7700/));
const {approvedContactReply,conditionalPriceReply,mileageClarification}=require(path.join(dir,'policy-checks.js'));
const {LOCATION_TEXT,CUSTOMER_CALL_CHOICE}=require(path.join(dir,'contact.js'));
check(()=>assert.equal(approvedContactReply(`${LOCATION_TEXT}\n${CUSTOMER_CALL_CHOICE}`),true));
check(()=>assert.equal(approvedContactReply("Our team will call you tomorrow"),false));
for(const r of ["Agreed, we'll pay 75000 after inspection", "You're booked. Final price after inspection", "We offer 75k", "We accept your price after inspection"])check(()=>assert.equal(conditionalPriceReply(r),false));
check(()=>assert.equal(conditionalPriceReply("Final price after the free inspection. What time suits you?"),true));
for(const s of ['8.6 km','8,6 km','86.5kms','1.2 kilometres'])check(()=>assert.match(mileageClarification(s),/confirm the full mileage/));
for(const s of ['86000 km','86k km','8.6 lakh','tomorrow 8.30','Toyota Camry 2021'])check(()=>assert.equal(mileageClarification(s),null));
// Force test-judge outcomes to check the batch gate itself, without AI variability.
let mode='mixed';
require.cache[require.resolve(path.join(dir,'store.js'))]={exports:{settings:async()=>({config:{enabled:true,autoApprove:true}})}};
require.cache[require.resolve(path.join(dir,'..','claude.js'))]={exports:{getKayaReply:async(_s,_h,_m,_k,l)=>l.skills?.length?'Improved':'Baseline'}};
const reviewer=require(path.join(dir,'reviewer.js'));reviewer.jsonReview=async(_s,pairs)=>({cases:pairs.map((p,index)=>({index,before_score:2,after_score:3,rules_preserved:true,observed_problem_fixed:mode!=='mixed'||index!==1}))});
const {replayGate}=require(path.join(dir,'replay.js'));
const input={label:'Issue',message:'known details',step:4,known:{},history:[]};
(async()=>{
 await assert.rejects(replayGate({version:1,aliases:[]},{version:1,aliases:[],skills:['avoid_repetition']},[input,input],[input]),/unfixed/);assertions++;
 mode='all';check(()=>assert.ok(assertions>700));
 console.log(`Stress suite passed: ${assertions} assertions covering wording variants, exact matching, negation/consent isolation, Unicode, privacy preservation and multi-issue release gates.`);
})().catch(e=>{console.error(e);process.exitCode=1});
