// Production-build regression guard: exercise the real TypeScript conversation engine.
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (mod, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const js = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  mod._compile(js, filename);
};
const {planTurn} = require("../lib/conversation-state.ts");
const now = new Date("2026-10-26T06:00:00Z");
let assertions = 0;
function assert(ok, msg) { assertions++; if (!ok) throw Error(msg); }
function turn(chat, input) {
  const messages = chat.messages ?? [];
  const result = planTurn({...chat, messages}, input, {}, now);
  Object.assign(chat, result.updates);
  chat.messages = [...messages, {role:"user",content:input},{role:"assistant",content:result.reply}];
  return result;
}
for (let mask = 0; mask < 128; mask++) {
  const chat = {messages:[]};
  if(mask&1)chat.make="Kia";
  if(mask&2)chat.model="Seltos";
  if(mask&4)chat.year="2023";
  if(mask&8)chat.mileage="65000";
  if(mask&16)chat.specs="Unknown";
  if(mask&32)chat.loan="No";
  if(mask&64)chat.sell_timeline="ASAP";
  const seen = new Set();
  let bookingPrompt = false;
  for(let n=0;n<12;n++){
    const r=turn(chat,"Condition like new");
    assert(r.state.status!=="team_accepted" && r.state.question!=="callback", "Unrequested callback mask="+mask);
    const q=r.state.question;
    if(q==="time"||q==="exact_time"){bookingPrompt=true;break;}
    assert(!seen.has(q),"Repeated field "+q+" mask="+mask);
    seen.add(q);
  }
  assert(bookingPrompt,"Never reached booking mask="+mask);
}
const mileage = {make:"Kia",model:"Seltos",year:"2023",messages:[]};
turn(mileage,"Hi");
const m=turn(mileage,"65k");
assert(m.updates.mileage==="65000","65k not captured");
assert(!/mileage/i.test(m.reply),"Repeated mileage after 65k");
const unknown={make:"Toyota",model:"Camry",year:"2020",mileage:"80000",messages:[]};
turn(unknown,"Hi");
const u=turn(unknown,"I don't know");
assert(u.updates.specs==="Unknown"||unknown.specs==="Unknown"||u.state.question!=="specs","Stuck on specs");
const callback={make:"Kia",model:"Optima",year:"2016",messages:[]};
const cb=turn(callback,"Please call me tomorrow");
assert(cb.state.status==="team_accepted" && !cb.confirm,"Callback became appointment");
const nonGcc={make:"Toyota",model:"Camry",year:"2021",mileage:"30000",messages:[]};
const ng=turn(nonGcc,"American specs");
assert(!ng.confirm,"Non-GCC claim booked");
const booking={make:"Kia",model:"Optima",year:"2016",messages:[]};
const offer=turn(booking,"I want to sell tomorrow");
assert(!offer.confirm,"Booked without time or consent");
const timed=turn(booking,"4pm");
assert(!timed.confirm,"Booked without name");
const named=turn(booking,"My name is Daniel");
assert(named.confirm && named.state.status==="booked","Agreed appointment was not booked");

const urgent={name:"Daniel",make:"BMW",model:"X5",year:"2023",mileage:"Unknown",specs:"GCC",loan:"No",sell_timeline:"Now",messages:[]};
const priceReply=turn(urgent,"Can you give me price first");
assert(!/would you like to arrange the inspection/i.test(priceReply.reply),"Price reply re-asks appointment");
assert(/what time can you bring/i.test(priceReply.reply),"Price reply lacks contextual arrival question");
const homeReply=turn(urgent,"You can come to my place?");
assert(/all our inspections take place at our branch/i.test(homeReply.reply),"Home visit response is negative");
assert(/10.15 minutes/i.test(homeReply.reply),"Home visit reply omits inspection duration");
const uncertain=turn(urgent,"I'm not sure when I can come");
assert(uncertain.state.question==="callback","Uncertain visit does not offer callback");
const accepted=turn(urgent,"Ok");
assert(accepted.state.status==="team_accepted","Accepted callback not handed over");
const late={name:"Daniel",make:"BMW",model:"X5",year:"2023",mileage:"Unknown",specs:"GCC",loan:"No",sell_timeline:"Now",messages:[]};
const lateReply=planTurn(late,"Can you give me price first",{},new Date("2026-10-26T19:30:00Z"));
assert(/tomorrow at 10 AM/i.test(lateReply.reply),"After-hours next day wording incorrect");
const earlyReply=planTurn(late,"Can you give me price first",{},new Date("2026-10-26T22:30:00Z"));
assert(/today/i.test(earlyReply.reply),"After midnight should refer to today");

console.log("Kaya conversation stress checks passed:",assertions);
