const fs=require('fs'),ts=require('typescript'),Module=require('module'),assert=require('assert/strict');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const real=Module._load;
Module._load=function(id,parent,...rest){if(parent?.filename.endsWith('emergency-basic-bot.ts')&&['./supabase','./meta','./claude','./bigin'].includes(id))return {};if(id==='@/lib/carData')return real.call(this,require('path').resolve(__dirname,'../lib/carData.ts'),parent,...rest);return real.call(this,id,parent,...rest);};
const {planEmergencyTurn}=require('../lib/emergency-basic-bot.ts');
const now=new Date('2026-10-26T06:00:00Z');
const base=()=>({phone:'971501234567',messages:[]});
function turn(c,text,fields={}){const r=planEmergencyTurn(c,text,fields,now);Object.assign(c,r.updates);c.messages.push({role:'user',content:text},{role:'assistant',content:r.reply});return r;}
let c=base();assert.match(turn(c,'Start').reply,/name/);turn(c,'Marc');assert.equal(c.name,'Marc');turn(c,'Toyota Camry 2022',{make:'Toyota',model:'Camry',year:'2022'});assert.equal(c.flow_state.basicStep,'vehicle');turn(c,'50000 GCC',{mileage:'50000',specs:'GCC'});assert.equal(c.flow_state.basicStep,'timeline');turn(c,'Today');assert.equal(c.flow_state.basicStep,'daytime');let r=turn(c,'Book tomorrow at 11 am');assert.equal(c.flow_state.basicStep,'done');assert.doesNotMatch(r.reply,/Please confirm|Is that correct|Dubai time|2026-10|Mon–Sat/);assert.equal(r.action,'booked');assert.equal(c.appointment_date,'2026-10-27');assert.match(r.reply,/maps.app/);r=turn(c,'Thanks');assert.equal(r.action,'collecting');assert.equal(c.flow_state.status,'booked');
c=base();turn(c,'Start');r=turn(c,'How much?');assert.equal(c.flow_state.basicStep,'objection_choice');r=turn(c,'How much will you pay?');assert.equal(c.flow_state.basicStep,'callback');assert.match(r.reply,/name/);r=turn(c,'John');assert.equal(r.action,'callback');assert.equal(c.name,'John');assert.equal(turn(c,'yes').action,'collecting');
c={...base(),name:'Marc',make:'BMW',model:'X5',year:'2022',mileage:'40000',specs:'GCC',flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'daytime'}};r=turn(c,'Friday at 11 am');assert.notEqual(r.action,'booked');assert.match(r.reply,/isn't available/);assert.doesNotMatch(r.reply,/Monday–Saturday|Dubai time/);r=turn(c,'Sunday at 2 pm');assert.equal(r.action,'collecting');c={...base(),name:'Marc',make:'BMW',model:'X5',year:'2022',mileage:'40000',specs:'GCC',flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'daytime'}};turn(c,'Tuesday');r=turn(c,'11 am');assert.equal(c.flow_state.basicStep,'done');
c={...base(),name:'Marc',flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'vehicle'}};r=turn(c,'I cannot come');assert.equal(r.state.basicStep,'objection_choice');assert.match(r.reply,/virtual assistant/);r=turn(c,'I still cannot come');assert.equal(r.action,'callback');assert.doesNotMatch(r.reply,/make|model|year/);
console.log('Emergency V1: booking, missing fields, objections, callbacks, terminal state, Friday and Sunday checks passed');

// Exact customer transcript: no repeated hours, ISO date or final YES needed.
c={...base(),name:'Jace',make:'BMW',model:'X5',year:'2020',mileage:'125000',specs:'GCC',flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'choice'}};
const sunday=new Date('2026-10-25T11:16:00Z');
function sundayTurn(text,fields={}){const r=planEmergencyTurn(c,text,fields,sunday);Object.assign(c,r.updates);c.messages.push({role:'user',content:text},{role:'assistant',content:r.reply});return r;}
assert.equal(sundayTurn('Book inspecrion').reply,'Which day and time do you want for the inspection?');
assert.equal(sundayTurn('Tomorrow').reply,'What time do you want for the inspection?');
r=sundayTurn('2 pm');assert.equal(r.action,'booked');assert.match(r.reply,/Monday 26th of October at 2 pm/);assert.doesNotMatch(r.reply,/2026-10|14:00|Dubai time|Please confirm|Is that correct|10 AM/);
// Ask only missing data, then immediately book when the last field arrives.
c={...base(),make:'BMW',model:'X5',year:'2020',mileage:'125000',specs:'GCC',flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'daytime'}};
r=turn(c,'tomorrow at 2 pm');assert.equal(r.action,'collecting');assert.match(r.reply,/name/);r=turn(c,'Jace');assert.equal(r.action,'booked');
// Previously deployed chats stuck awaiting YES remain compatible.
c={...base(),name:'Jace',make:'BMW',model:'X5',year:'2020',mileage:'125000',specs:'GCC',flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'confirm',proposedDate:'2026-10-27',proposedTime:'14:00'}};
assert.equal(turn(c,'Yes').action,'booked');
console.log('Simplified scheduling: exact transcript, automatic confirmation, missing data and legacy YES passed');

// Current report: uncertainty is a complete specs answer and must not be repeated.
c=base();turn(c,'Start');assert.equal(turn(c,'Jace').reply,'Which car are you planning to sell?');
r=turn(c,'Bmw 2020 x5 not sure',{make:'BMW',model:'X5',year:'2020'});assert.equal(c.specs,'Unknown');assert.equal(r.reply.replace(/^No problem\. /,''),'What is the mileage?');
r=turn(c,'125k km');assert.equal(c.mileage,'125000');assert.equal(r.reply.replace(/^No problem\. /,''),'When are you planning to sell the car?');assert.doesNotMatch(r.reply,/GCC|mileage/);
// Each missing field is asked once. Ignored answers do not cause loops or block booking.
c=base();turn(c,'Start');turn(c,'Jace');let prompts=[];
for(let i=0;i<6;i++)prompts.push(turn(c,'okay').reply);
assert.equal(new Set(prompts.slice(0,5)).size,5);assert.equal(prompts.filter(p=>p==='What is the mileage?').length,1);assert.equal(prompts.filter(p=>p==='Is it GCC or non-GCC?').length,1);assert.ok(prompts.includes('When are you planning to sell the car?'));
turn(c,'book');turn(c,'tomorrow');r=turn(c,'2 pm');assert.equal(r.action,'booked');
// Uncertain specs with punctuation or do-not-know must stay in the basic flow.
for(const answer of ["not sure?","I don't know","I do not know"]){
 c={...base(),name:'Jace',make:'BMW',model:'X5',year:'2020',mileage:'125000',flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'vehicle',askedVehicle:['specs']},messages:[{role:'assistant',content:'Is it GCC or non-GCC?'}]};
 r=turn(c,answer);assert.equal(c.specs,'Unknown');assert.equal(r.reply.replace(/^No problem\. /,''),'When are you planning to sell the car?');
}
// Non-GCC and numeric mileage are retained; already captured fields are skipped.
c={...base(),name:'Jace',make:'BMW',model:'X5',year:'2020',flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'vehicle'},messages:[]};
r=turn(c,'Non GCC');assert.equal(c.specs,'Non-GCC');assert.equal(r.reply.replace(/^No problem\. /,''),'What is the mileage?');r=turn(c,'125000');assert.equal(c.mileage,'125000');assert.equal(r.reply.replace(/^No problem\. /,''),'When are you planning to sell the car?');
console.log('One-at-a-time collection: reported chat, uncertain specs, skipped answers and known-field checks passed');

// Historical Patrol chat: preserve all facts, interpret 22 as year, and go to booking.
c={...base(),name:'mo',make:'Nissan',model:'Patrol',mileage:'22',specs:'GCC',messages:[
 {role:'assistant',content:'May I know your name?'},{role:'user',content:'Nissan Patrol'},
 {role:'assistant',content:"What's the model and year?"},{role:'user',content:'Nesmo'},{role:'user',content:'22'},
 {role:'assistant',content:"What's the mileage?"},{role:'user',content:'47000 km'},
 {role:'assistant',content:'Is it GCC specs?'},{role:'user',content:'GCC'},
 {role:'assistant',content:'When are you planning to sell?'},
]};
r=turn(c,'Now');assert.equal(c.make,'Nissan');assert.equal(c.model,'Patrol');assert.equal(c.year,'2022');assert.equal(c.mileage,'47000');assert.equal(r.reply,'What time can you come today?');r=turn(c,'tomorrow at 2 pm');assert.equal(r.action,'booked');assert.doesNotMatch(r.reply,/make|model|year/);
// Once prompted to schedule, refusal/unrelated answers hand over without repeating questions.
c={...base(),name:'mo',make:'Nissan',model:'Patrol',flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'timeline'}};
assert.equal(turn(c,'Now').state.basicStep,'daytime');assert.equal(turn(c,'maybe later').action,'callback');
console.log('Historical Patrol regression: stored facts, 2022 year, 47000 mileage, NOW-to-booking and noncompliance passed');

c={...base(),name:'mo',make:'Nissan',model:'Patrol',year:'2022',mileage:'22',specs:'GCC',messages:[{role:'user',content:'47000 km'},{role:'assistant',content:"We're closed on Sundays. What time can you bring your car on Monday?"}]};
r=planEmergencyTurn(c,'Now',{},new Date('2026-10-25T12:00:00Z'));assert.equal(r.state.basicStep,'daytime');assert.match(r.reply,/What time can you come tomorrow/);assert.equal(r.updates.mileage,'47000');assert.doesNotMatch(r.reply,/make|model|year/);

// NOW in scheduling uses inspection opening hours in Dubai and never repeats.
for(const [clock,expected,day] of [
 ['2026-10-26T08:00:00Z','What time can you come today?','2026-10-26'],
 ['2026-10-25T13:04:00Z',"We're closed now, but we open again tomorrow at 10 am. What time can you come tomorrow?",'2026-10-26'],
 ['2026-10-26T15:00:00Z',"We're closed now, but we open again tomorrow at 10 am. What time can you come tomorrow?",'2026-10-27'],
 ['2026-10-30T07:00:00Z',"We're closed now, but we open again tomorrow at 10 am. What time can you come tomorrow?",'2026-10-31'],
 ['2026-10-31T15:00:00Z',"We're closed now, but we open again Monday 2nd of November at 10 am. What time can you come Monday 2nd of November?",'2026-11-02'],
]){
 c={...base(),name:'Jace',make:'BMW',model:'X5',year:'2020',mileage:'125000',specs:'Unknown',flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'daytime'}};
 r=planEmergencyTurn(c,'Now',{},new Date(clock));assert.equal(r.reply,expected);assert.equal(r.state.proposedDate,day);
 Object.assign(c,r.updates);c.messages.push({role:'assistant',content:r.reply});
 const booked=planEmergencyTurn(structuredClone(c),'2 pm',{},new Date(clock));assert.equal(booked.action,'booked');assert.equal(booked.updates.appointment_date,day);
 r=planEmergencyTurn(c,'Now',{},new Date(clock));assert.notEqual(r.reply,expected);assert.equal(r.action,'callback');
}
console.log('NOW opening-hours checks: today, closed Sunday, after closing, Friday, weekend and no repetition passed');

// Ignoring the name to give selling intent is valid input, not an objection.
c=base();turn(c,'Start');r=turn(c,'I want to sell my bmw');assert.equal(c.make,'BMW');assert.equal(r.reply,'No problem, we can help you with that. Which model and year is the car?');assert.equal(c.flow_state.basicStep,'vehicle');assert.doesNotMatch(r.reply,/virtual assistant|callback/);
r=turn(c,'X5 2020');assert.equal(c.model,'X5');assert.equal(c.year,'2020');assert.equal(r.reply.replace(/^No problem\. /,''),'What is the mileage?');turn(c,'125k km');turn(c,"I don't know");turn(c,'Now');turn(c,'tomorrow at 2 pm');r=turn(c,'Jace');assert.equal(r.action,'booked');
for(const [input,data,question] of [
 ['I want to sell my car',{},'Which car are you planning to sell?'],
 ['I want to sell my BMW X5',{make:'BMW',model:'X5'},'What year is it?'],
 ['Selling my BMW X5 2020',{make:'BMW',model:'X5',year:'2020'},'What is the mileage?'],
]){c=base();turn(c,'Start');r=turn(c,input);for(const [k,v]of Object.entries(data))assert.equal(c[k],v);assert.equal(r.reply,'No problem, we can help you with that. '+question);}
// A seller who was already shown the fallback can return to collecting details.
c={...base(),flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'choice',offscript:true}};r=turn(c,'I want to sell my BMW');assert.match(r.reply,/model and year/);assert.equal(r.state.offscript,false);
console.log('Selling intent: missing-name bypass, known vehicle fields, fallback recovery and booking passed');

for(const [input,make]of [['I want to sell my Toyota','Toyota'],['I want to sell my Nissan','Nissan'],['I want to sell my Ford','Ford'],['I want to sell my Audi','Audi'],['I want to sell my Porsche','Porsche'],['I want to sell my Honda','Honda']]){
 c=base();turn(c,'Start');r=turn(c,input);assert.equal(c.make,make);assert.match(r.reply,/model and year/);assert.doesNotMatch(r.reply,/virtual assistant|callback/);
}
for(const input of ['My car','Car','I want to sell a vehicle']){c=base();turn(c,'Start');r=turn(c,input);assert.match(r.reply,/Which car are you planning to sell/);assert.equal(c.name,undefined);}
console.log('Brand-independent selling intent and generic car/vehicle messages passed');

// Exact report: acknowledgement after a missing-name request never repeats that request.
c={...base(),make:'Toyota',model:'Corolla',year:'2009',flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'daytime'}};
r=turn(c,"I'll let you nlknow");assert.match(r.reply,/Please provide your name/);
const request=r.reply;r=turn(c,'Ok');assert.notEqual(r.reply,request);assert.doesNotMatch(r.reply,/provide your name/);assert.equal(r.action,'callback');
let sent=new Set(c.messages.filter(m=>m.role==='assistant').map(m=>m.content));
for(const text of ['Ok','Ok','Thanks','Ok','Thanks']){r=turn(c,text);if(r.reply){assert.ok(!sent.has(r.reply),'Duplicate text was emitted');sent.add(r.reply);}}
// Legacy callback state without tracking still sees that the name was already asked.
c={...base(),flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'callback'},messages:[{role:'assistant',content:request}]};r=turn(c,'Ok');assert.doesNotMatch(r.reply,/provide your name/);assert.equal(r.action,'callback');
// Persistent dedupe survives message truncation and harmless punctuation differences.
c={...base(),flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'done',status:'team_accepted',sentReplies:['thank you']},messages:[]};r=turn(c,'Ok');assert.equal(r.reply,'');
console.log('All-reply dedupe: callback acknowledgement, legacy state, terminal messages and persistent history passed');

for(const [clock,expected]of [['2026-10-26T05:00:00Z','Good morning'],['2026-10-26T10:00:00Z','Good afternoon'],['2026-10-26T14:00:00Z','Good evening']]){
 for(const hello of ['Hi','Hello','Hey','Good morning']){
  c={...base(),flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'name'},messages:[{role:'assistant',content:'May I know your name please?'}]};
  r=planEmergencyTurn(c,hello,{},new Date(clock));assert.equal(r.reply,expected+'. Which car are you planning to sell?');assert.equal(r.state.basicStep,'vehicle');assert.equal(r.updates.name,undefined);
 }
}
for(const [input,label]of [['[photo]','pictures'],['[file]','files'],['[audio]','voice notes'],['https://example.com/car','links']]){
 c={...base(),name:'Jace',make:'BMW',model:'X5',year:'2020',flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'vehicle',askedVehicle:['mileage']},messages:[{role:'assistant',content:'What is the mileage?'}]};
 r=turn(c,input);assert.match(r.reply,new RegExp('not able to open '+label));assert.match(r.reply,/type the mileage/);assert.equal(r.state.basicStep,'vehicle');assert.equal(c.mileage,undefined);
 r=turn(c,'125k km');assert.equal(c.mileage,'125000');assert.equal(r.reply,'Is it GCC or non-GCC?');
}
c={...base(),name:'Jace',flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'timeline'}};r=turn(c,'[audio]');assert.match(r.reply,/when you are planning to sell/);assert.equal(r.state.basicStep,'timeline');
c={...base(),name:'Jace',make:'BMW',model:'X5',year:'2020',flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'vehicle',askedVehicle:['mileage']}};r=turn(c,'[photo] 125k km');assert.equal(c.mileage,'125000');assert.match(r.reply,/pictures/);assert.match(r.reply,/GCC/);
console.log('Greetings and media: time-aware greeting, photos, files, audio, links, pending stage and captions passed');

// Exact report: capture make AND selling timeline, finish details, skip answered timeframe.
c=base();turn(c,'Start');turn(c,'Hi');r=turn(c,"I'm selling my bmw next month");
assert.equal(c.make,'BMW');assert.equal(c.sell_timeline,'next month');assert.equal(r.reply,'No problem, we can help you with that. Which model and year is the car?');assert.equal(r.state.basicStep,'vehicle');
r=turn(c,'X5 2020');assert.equal(r.reply.replace(/^No problem\. /,''),'What is the mileage?');r=turn(c,'125k km');assert.equal(r.reply,'Is it GCC or non-GCC?');r=turn(c,"I'm not sure");assert.equal(r.reply.replace(/^No problem\. /,''),'Would you like to book a free inspection this week or next month?');assert.equal(c.sell_timeline,'next month');assert.doesNotMatch(r.reply,/When are you planning/);
// Same rule in name stage and for every brand, including when some details are known.
for(const input of ['I want to sell my Toyota next month','Selling my Nissan next week']){
 c=base();turn(c,'Start');r=turn(c,input);assert.match(r.reply,/model and year/);assert.equal(r.state.basicStep,'vehicle');assert.ok(c.sell_timeline);
}
c={...base(),name:'Jace',make:'Toyota',model:'Corolla',flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'vehicle'}};r=turn(c,'Selling next month');assert.equal(r.reply,'No problem, we can help you with that. What year is it?');assert.equal(c.sell_timeline,'next month');
console.log('Combined selling data: capture timeline, finish missing car fields and skip answered timeframe passed');

// Future seller is offered this week or next month after details, then books their selection.
for(const window of ['This week','Next month']){
 c={...base(),name:'Jace',make:'BMW',model:'X5',year:'2020',mileage:'125000',sell_timeline:'next month',flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'vehicle'}};
 r=turn(c,'GCC');assert.equal(r.reply.replace(/^No problem\. /,''),'Would you like to book a free inspection this week or next month?');assert.equal(r.state.basicStep,'inspection_window');
 r=turn(c,window);assert.equal(r.state.basicStep,'daytime');
 r=turn(c,window==='This week'?'tomorrow at 2 pm':'5 November at 2 pm');assert.equal(r.action,'booked');assert.equal(c.appointment_date,window==='This week'?'2026-10-27':'2026-11-05');
}
for(const inquiry of ['What price can you offer?','Do you offer home service?','How does the inspection work?','How much for an inspection tomorrow?']){
 c={...base(),name:'Jace',flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'inspection_window'}};
 r=turn(c,inquiry);assert.equal(r.state.basicStep,'objection_choice');assert.match(r.reply,/virtual assistant/);assert.match(r.reply,/continue booking|free inspection/);r=turn(c,inquiry);assert.equal(r.action,'callback');
}
console.log('Future-inspection choices and direct inquiry-to-callback protocol passed');

// A stated asking price is data, never a quote request or mileage.
c=base();turn(c,'Start');turn(c,'Hi');turn(c,'I want to sell my Toyota Camry');turn(c,'2020');r=turn(c,'Only 20k km\nAsking 75k');assert.equal(c.mileage,'20000');assert.equal(c.flow_state.askingPriceAed,'75000');assert.equal(r.reply,'Is it GCC or non-GCC?');r=turn(c,'GCC');assert.equal(r.reply.replace(/^No problem\. /,''),'When are you planning to sell the car?');r=turn(c,'Now');assert.equal(r.state.basicStep,'daytime');assert.doesNotMatch(r.reply,/callback/);
for(const input of ['Asking price 75k','My price is AED 75000','Selling price 75,000']){
 c={...base(),name:'Jace',make:'Toyota',model:'Camry',year:'2020',mileage:'20000',flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'vehicle'}};
 r=turn(c,input);assert.equal(c.flow_state.askingPriceAed,'75000');assert.equal(c.mileage,'20000');assert.equal(r.reply,'Is it GCC or non-GCC?');assert.equal(r.action,'collecting');
}
// Booking interruption: offer resume or callback. Resume preserves the proposed day.
c={...base(),name:'Jace',make:'Toyota',model:'Camry',year:'2020',mileage:'20000',specs:'GCC',flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'daytime',proposedDate:'2026-10-27'}};
r=turn(c,'How much will you pay?');assert.equal(r.state.basicStep,'objection_choice');assert.match(r.reply,/continue booking/);assert.match(r.reply,/callback/);r=turn(c,'Continue booking');assert.equal(r.state.proposedDate,'2026-10-27');r=turn(c,'2 pm');assert.equal(r.action,'booked');
// A price statement alone during scheduling does not become a callback.
c={...base(),name:'Jace',flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'daytime'}};r=turn(c,'Asking 75k');assert.equal(r.state.basicStep,'daytime');assert.equal(r.action,'collecting');assert.doesNotMatch(r.reply,/virtual assistant/);
console.log('Stated asking prices, retained mileage, objection choice, repeated objections and resumed bookings passed');

// First answer may be the brand/model, with common brand aliases and no name or sell verb.
for(const [input,make,model]of [['Mercedes s500','Mercedes-Benz','S500'],['Mercedes C200','Mercedes-Benz','C200'],['BMW X5','BMW','X5'],['Toyota Camry','Toyota','Camry'],['Nissan Patrol','Nissan','Patrol'],['VW Golf','Volkswagen','Golf']]){
 c={...base(),flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'name'},messages:[{role:'assistant',content:'May I know your name please?'}]};
 r=turn(c,input);assert.equal(c.make,make);assert.equal(c.model,model);assert.equal(c.name,undefined);assert.equal(r.reply,'Ok, nice. What year is it?');assert.equal(r.state.basicStep,'vehicle');
 r=turn(c,'2020');assert.equal(r.reply.replace(/^No problem\. /,''),'What is the mileage?');turn(c,'50000 km');turn(c,'GCC');turn(c,'Now');turn(c,'tomorrow at 2 pm');r=turn(c,'Jace');assert.equal(r.action,'booked');
}
c={...base(),flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'name'},messages:[{role:'assistant',content:'May I know your name?'}]};r=turn(c,'Mercedes S500 2020');assert.equal(c.year,'2020');assert.equal(r.reply,'Ok, nice. What is the mileage?');
console.log('First-answer vehicle recognition: aliases, Mercedes variants, missing-field checks and complete bookings passed');

// Sweep the entire registry instead of assuming the Mercedes fix covers other brands.
const {CAR_MAKES,CAR_MODELS}=require('../lib/carData.ts');
let brandCases=0;const failures=[];
for(const [alias,make]of Object.entries(CAR_MAKES)){
 for(const spelling of new Set([make,alias])){
  const model=CAR_MODELS[make]?.[0];
  for(const input of [spelling,model?spelling+' '+model:null].filter(Boolean)){
   c={...base(),flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'name'},messages:[{role:'assistant',content:'May I know your name?'}]};
   r=turn(c,input);brandCases++;
   if(c.make!==make||c.name||r.state.basicStep!=='vehicle'||/virtual assistant|callback/.test(r.reply)||(model&&input!==spelling&&c.model!==model))failures.push({input,expected:make,actual:c.make,model:c.model,reply:r.reply});
  }
 }
}
assert.deepEqual(failures,[]);console.log('All-brand registry sweep passed: '+brandCases+' brand and model cases');

let modelCases=0;const modelFailures=[];
for(const [make,models]of Object.entries(CAR_MODELS))for(const model of models){
 c={...base(),flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'name'},messages:[{role:'assistant',content:'May I know your name?'}]};
 r=turn(c,make+' '+model);modelCases++;
 if(c.make!==(CAR_MAKES[make]||make)||c.model!==model||c.name||r.state.basicStep!=='vehicle'||/virtual assistant|callback/.test(r.reply))modelFailures.push({make,model,actualMake:c.make,actualModel:c.model,reply:r.reply});
}
assert.deepEqual(modelFailures,[]);console.log('Complete model registry sweep passed: '+modelCases+' brand/model combinations');

// Current transcript: urgency variants never set Sunday as the proposed visit.
const sundayEvening=new Date('2026-10-25T14:19:00Z');
for(const stage of ['timeline','daytime'])for(const urgent of ['Now','I can come now','Can I come now?','I will come right away','I can bring the car now']){
 c={...base(),name:'Jace',make:'Mercedes-Benz',model:'S500',year:'2020',mileage:'125000',specs:'Unknown',flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:stage}};
 r=planEmergencyTurn(c,urgent,{},sundayEvening);assert.equal(r.reply,"We're closed now, but we open again tomorrow at 10 am. What time can you come tomorrow?");assert.equal(r.state.proposedDate,'2026-10-26');
 Object.assign(c,r.updates);c.messages.push({role:'assistant',content:r.reply});
 r=planEmergencyTurn(c,'8 pm',{},sundayEvening);assert.equal(r.state.proposedDate,'2026-10-26');assert.equal(r.state.proposedTime,undefined);assert.match(r.reply,/10 am and 6:30 pm/);assert.doesNotMatch(r.reply,/Which day and time/);
 Object.assign(c,r.updates);c.messages.push({role:'assistant',content:r.reply});r=planEmergencyTurn(c,'2 pm',{},sundayEvening);assert.equal(r.action,'booked');assert.equal(r.updates.appointment_date,'2026-10-26');
}
for(const uncertain of ["I don't know","I'm not sure",'Not sure','No idea','Dont know']){
 c={...base(),make:'Mercedes-Benz',model:'S500',year:'2020',mileage:'125000',flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'vehicle',askedVehicle:['specs']}};
 r=turn(c,uncertain);assert.equal(r.reply,'No problem. When are you planning to sell the car?');assert.equal(c.specs,'Unknown');
}
console.log('Urgency phrases: Sunday next opening, late-time correction, retained day, booking and uncertainty acknowledgements passed');
