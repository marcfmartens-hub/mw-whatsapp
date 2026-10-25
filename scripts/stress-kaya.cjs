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
// External listing link and follow-up must not advance to mileage/specs/selling timeline.
const linked = {messages:[]};
turn(linked,"Hi");
const listing=turn(linked,"https://carswitch.com/car/895725/ad");
assert(/can't open external links/i.test(listing.reply),"Listing link not explained");
assert(/make, model and year/i.test(listing.reply),"Listing link skipped vehicle details");
const check=turn(linked,"Check this link for all info");
assert(/can't open external links/i.test(check.reply),"Link follow-up not handled");
assert(check.state.question==="vehicle","Link follow-up advanced questionnaire");
const again=turn(linked,"Check this");
// Third reminder: stop repeating, offer the team (never advance to mileage/specs/selling timeline).
assert(again.state.question==="callback" && /can't open external links/i.test(again.reply) && /call you/i.test(again.reply),"Repeated link did not offer the team");
assert(again.reply!==check.reply,"Link reminder repeated word for word");
const picture=turn(linked,"[photo]");
assert(/can't open external links/i.test(picture.reply),"Photo placeholder not handled");
assert(picture.state.status==="team_accepted","Repeated media was not handed to the team");
const frustrated=turn(linked,"Crazy bot");
assert(/understand your frustration/i.test(frustrated.reply),"Frustration ignored");
assert(frustrated.state.question==="callback","Frustration did not offer human help");
const mileage = {name:"Daniel",make:"Kia",model:"Seltos",year:"2023",messages:[]};
turn(mileage,"Hi");
const m=turn(mileage,"65k");
assert(m.updates.mileage==="65000","65k not captured");
assert(!/mileage/i.test(m.reply),"Repeated mileage after 65k");
const unknown={name:"Daniel",make:"Toyota",model:"Camry",year:"2020",mileage:"80000",messages:[]};
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
assert(/Tuesday/i.test(lateReply.reply),"Monday after-hours must offer Tuesday");
const earlyReply=planTurn(late,"Can you give me price first",{},new Date("2026-10-26T22:30:00Z"));
assert(/today/i.test(earlyReply.reply),"Tuesday after midnight should offer today");

// Real customer failures must remain blocked by every production build.
const priceSeller={make:"Toyota",model:"Camry",year:"2008",mileage:"300000",specs:"GCC",sell_timeline:"Leaving next month",messages:[]};
const priceFirst=turn(priceSeller,"How much you can give");
assert(/cash purchase|cash deal/i.test(priceFirst.reply),"Price question ignored");
assert(!/may i have your name/i.test(priceFirst.reply),"Price question overridden by name");
const priceAgain=turn(priceSeller,"Price");
assert(!/may i have your name/i.test(priceAgain.reply),"Repeated price request overridden by name");
const angry=turn(priceSeller,"Are you stupid");
assert(/sorry/i.test(angry.reply)&&!/may i have your name/i.test(angry.reply),"Customer frustration ignored");
const paused={messages:[]};
const pause=turn(paused,"I'm busy now I'll get back to you");
assert(pause.state.status==="customer_will_contact"&&!/make|model|year/i.test(pause.reply),"Pause intent ignored");
const buyer={messages:[]};
const buying=turn(buyer,"Do you have Sonata 2017?");
assert(/sales team/i.test(buying.reply),"Buyer intent not recognized");
const buyerFollow=turn(buyer,"I am looking to buy instead sir");
assert(!/mileage|gcc specs|planning to sell/i.test(buyerFollow.reply),"Buyer redirected into seller flow");
// Chats reported on 25 Oct 2026: Kaya must read each answer, never loop, and end in a booking or a team call.
const same=(chat)=>{const a=(chat.messages??[]).filter(m=>m.role==="assistant").map(m=>m.content.trim());return a.some((x,i)=>i&&x===a[i-1]);};
// BMW chat: pitch once, price push gets a short answer, third push goes to the team.
const bmw={messages:[{role:"assistant",content:"Good morning! I'm Kaya from Mister Wheelz 😊 Before we start may I know your name please?"}]};
turn(bmw,"I want sell my car");turn(bmw,"Bmw x4 2016");
const bmwSpecs=turn(bmw,"Gcc");
assert(/free 10.15 min inspection/i.test(bmwSpecs.reply)&&/what time/i.test(bmwSpecs.reply),"BMW chat did not move to booking");
const bmwPrice=turn(bmw,"I want price dorst");
assert(!/Before buying your car/i.test(bmwPrice.reply)&&(bmwPrice.reply.match(/free 10.15 min inspection/gi)||[]).length===1,"Price reply repeated the inspection pitch");
assert(bmwPrice.reply.length<200,"Price reply too long for WhatsApp");
turn(bmw,"price please");
const bmwThird=turn(bmw,"just tell me the price");
assert(bmwThird.state.status==="team_accepted"&&bmwThird.crm==="lead","Price insistence did not reach the team");
assert(!same(bmw),"BMW chat repeated a reply word for word");
// Kia chat: unrelated answers to the time question never loop back to the questionnaire.
const kia={name:"Sam",make:"Kia",model:"Optima",year:"2016",mileage:"90000",specs:"GCC",loan:"No",sell_timeline:"Soon",messages:[]};
let handed=false;
for(let n=0;n<6&&!handed;n++){const r=turn(kia,"Condition like new");assert(!/make, model and year|mileage|GCC specifications|name/i.test(r.reply),"Stalled chat fell back to questionnaire: "+r.reply);handed=r.state.status==="team_accepted"||r.state.question==="callback";}
assert(handed,"Stalled chat never offered the team");
assert(!same(kia),"Kia chat repeated a reply word for word");
// Lijo chat: "65000k" then "65k" keeps the normal flow and reaches the selling timeline.
const lijo={messages:[{role:"assistant",content:"Hello. Please let us know how we can help you, or if you need a call back from our team."}]};
turn(lijo,"Lijo");turn(lijo,"Kia seltos 2023");
const lijoKm=turn(lijo,"65000k");
assert(lijo.mileage==="65000"&&!/still need that detail|purchasing team/i.test(lijoKm.reply),"Mileage answer not read");
turn(lijo,"65k");
assert(/planning to sell/i.test(lijo.messages.at(-1).content),"Flow did not continue to the selling timeline");
// Buyer chat: the name is asked once, then the enquiry is recorded.
const buyer2={messages:[{role:"assistant",content:"Hello. Please let us know how we can help you, or if you need a call back from our team."}]};
turn(buyer2,"Do you have sonata 2017");
const buyerName=turn(buyer2,"Or camry spider");
assert(buyerName.state.status==="team_accepted"&&!/your name/i.test(buyerName.reply),"Buyer name question repeated");
// Booking confirmation: real line breaks, location once.
const bookNow=planTurn({name:"Sam",make:"BMW",model:"X4",year:"2016",mileage:"90000",specs:"GCC",messages:[],flow_state:{version:1,status:"visit_proposed",question:"time",proposedDate:"2026-10-26"}},"3pm",{},now);
assert(!bookNow.reply.includes("\\n")&&(bookNow.reply.match(/maps\.app/g)||[]).length===1,"Booking confirmation has literal \\n or duplicated location");
// Link chat: reminders differ and end with an offer of the team.
const link2={messages:[]};turn(link2,"Hi");turn(link2,"https://carswitch.com/car/895725/ad");turn(link2,"Check this link for all info");turn(link2,"Check this");
assert(!same(link2),"Link reminders repeated word for word");
console.log("Kaya conversation stress checks passed:",assertions);
