const fs=require('fs'),ts=require('typescript'),Module=require('module'),assert=require('assert/strict');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const real=Module._load;
Module._load=function(id,parent,...rest){if(parent?.filename.endsWith('emergency-basic-bot.ts')&&['./supabase','./meta','./claude','./bigin'].includes(id))return {};if(id==='@/lib/carData')return real.call(this,require('path').resolve(__dirname,'../lib/carData.ts'),parent,...rest);return real.call(this,id,parent,...rest);};
const {planEmergencyTurn}=require('../lib/emergency-basic-bot.ts');
const now=new Date('2026-10-26T06:00:00Z');
const base=()=>({phone:'971501234567',messages:[]});
function turn(c,text,fields={}){const r=planEmergencyTurn(c,text,fields,now);Object.assign(c,r.updates);c.messages.push({role:'user',content:text},{role:'assistant',content:r.reply});return r;}
let c=base();assert.match(turn(c,'Hi').reply,/name/);turn(c,'Marc');assert.equal(c.name,'Marc');turn(c,'Toyota Camry 2022',{make:'Toyota',model:'Camry',year:'2022'});assert.equal(c.flow_state.basicStep,'vehicle');turn(c,'50000 GCC',{mileage:'50000',specs:'GCC'});assert.equal(c.flow_state.basicStep,'timeline');turn(c,'Today');assert.equal(c.flow_state.basicStep,'choice');let r=turn(c,'Book tomorrow at 11 am');assert.equal(c.flow_state.basicStep,'done');assert.doesNotMatch(r.reply,/Please confirm|Is that correct|Dubai time|2026-10|Mon–Sat/);assert.equal(r.action,'booked');assert.equal(c.appointment_date,'2026-10-27');assert.match(r.reply,/maps.app/);r=turn(c,'Thanks');assert.equal(r.action,'collecting');assert.equal(c.flow_state.status,'booked');
c=base();turn(c,'Hi');turn(c,'How much?');assert.match(c.messages.at(-1).content,/virtual assistant/);r=turn(c,'Why?');assert.equal(c.flow_state.basicStep,'callback');assert.match(r.reply,/name/);r=turn(c,'John');assert.equal(r.action,'callback');assert.equal(c.name,'John');assert.equal(turn(c,'yes').action,'collecting');
c={...base(),name:'Marc',make:'BMW',model:'X5',year:'2022',mileage:'40000',specs:'GCC',flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'daytime'}};r=turn(c,'Friday at 11 am');assert.notEqual(r.action,'booked');assert.match(r.reply,/isn't available/);assert.doesNotMatch(r.reply,/Monday–Saturday|Dubai time/);r=turn(c,'Sunday at 2 pm');assert.notEqual(r.action,'booked');assert.match(r.reply,/isn't available/);turn(c,'Tuesday');r=turn(c,'11 am');assert.equal(c.flow_state.basicStep,'done');
c={...base(),name:'Marc',flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'vehicle'}};r=turn(c,'I cannot come');assert.equal(r.action,'callback');assert.doesNotMatch(r.reply,/make|model|year/);
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
c=base();turn(c,'Hi');assert.equal(turn(c,'Jace').reply,'Which car are you planning to sell?');
r=turn(c,'Bmw 2020 x5 not sure',{make:'BMW',model:'X5',year:'2020'});assert.equal(c.specs,'Unknown');assert.equal(r.reply,'What is the mileage?');
r=turn(c,'125k km');assert.equal(c.mileage,'125000');assert.equal(r.reply,'When are you planning to sell the car?');assert.doesNotMatch(r.reply,/GCC|mileage/);
// Each missing field is asked once. Ignored answers do not cause loops or block booking.
c=base();turn(c,'Hi');turn(c,'Jace');let prompts=[];
for(let i=0;i<7;i++)prompts.push(turn(c,'okay').reply);
assert.equal(new Set(prompts.slice(0,5)).size,5);assert.equal(prompts.filter(p=>p==='What is the mileage?').length,1);assert.equal(prompts.filter(p=>p==='Is it GCC or non-GCC?').length,1);assert.ok(prompts.includes('When are you planning to sell the car?'));
turn(c,'book');turn(c,'tomorrow');r=turn(c,'2 pm');assert.equal(r.action,'booked');
// Uncertain specs with punctuation or do-not-know must stay in the basic flow.
for(const answer of ["not sure?","I don't know","I do not know"]){
 c={...base(),name:'Jace',make:'BMW',model:'X5',year:'2020',mileage:'125000',flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'vehicle',askedVehicle:['specs']},messages:[{role:'assistant',content:'Is it GCC or non-GCC?'}]};
 r=turn(c,answer);assert.equal(c.specs,'Unknown');assert.equal(r.reply,'When are you planning to sell the car?');
}
// Non-GCC and numeric mileage are retained; already captured fields are skipped.
c={...base(),name:'Jace',make:'BMW',model:'X5',year:'2020',flow_state:{basicMode:'Emergency Chat Bot V1',basicStep:'vehicle'},messages:[]};
r=turn(c,'Non GCC');assert.equal(c.specs,'Non-GCC');assert.equal(r.reply,'What is the mileage?');r=turn(c,'125000');assert.equal(c.mileage,'125000');assert.equal(r.reply,'When are you planning to sell the car?');
console.log('One-at-a-time collection: reported chat, uncertain specs, skipped answers and known-field checks passed');
