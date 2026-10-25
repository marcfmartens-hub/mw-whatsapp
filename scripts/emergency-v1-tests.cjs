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
