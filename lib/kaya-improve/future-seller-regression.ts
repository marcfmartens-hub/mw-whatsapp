import {planTurn,type Chat} from "../conversation-state";
type Case={name:string;passed:boolean;detail:string};
export function futureSellerRegression():Case[]{
 const now=new Date("2026-10-25T08:10:00Z");
 const base:Chat={phone:"971501234567",name:"Jace",make:"BMW",model:"X5",year:"2020",mileage:"12000",specs:"GCC",loan:"No",messages:[{role:"assistant",content:"When are you planning to sell?"}]};
 const cases:Case[]=[];
 const first=planTurn(base,"I'm planning to leave in December but first want to know how much my car is worth",{},now);
 cases.push({name:"Future seller price inquiry offers both methods without booking",passed:!!first.state.salesConsultation&&/cash sale/i.test(first.reply)&&/consignment/i.test(first.reply)&&!/what time can you bring/i.test(first.reply),detail:first.reply});
 const second=planTurn({...base,...first.updates,messages:[...base.messages!,{role:"user",content:"I'm planning to leave in December but first want to know how much my car is worth"},{role:"assistant",content:first.reply}]},"I don't want to come without knowing the price",{},now);
 cases.push({name:"Price-first inspection refusal does not repeat booking",passed:!!second.state.visitDeclinedForPrice&&/callback|call you|team to call/i.test(second.reply)&&!/what time can you bring/i.test(second.reply),detail:second.reply});
 const third=planTurn({...base,...second.updates,messages:[...base.messages!,{role:"assistant",content:second.reply}]},"Please call me",{},now);
 cases.push({name:"UAE WhatsApp callback is recorded without appointment",passed:third.state.status==="team_accepted"&&third.crm==="lead"&&!third.updates.appointment_date,detail:third.reply});
 const foreign=planTurn({...base,phone:"447700900123",...first.updates},"Please call me",{},now);
 cases.push({name:"Non-UAE WhatsApp requests UAE callback number",passed:!!foreign.state.awaitingUaeCallbackNumber&&/UAE mobile number/i.test(foreign.reply),detail:foreign.reply});
 const number=planTurn({...base,phone:"447700900123",...foreign.updates},"+971 50 123 4567",{},now);
 cases.push({name:"Valid UAE callback number is captured",passed:number.state.status==="team_accepted"&&number.updates.alternative_phone==="+971501234567",detail:number.reply});
 const immediate=planTurn({...base,...first.updates},"I want to book an inspection this week",{},now);
 cases.push({name:"Explicit immediate inspection overrides consultation",passed:!immediate.state.salesConsultation,detail:immediate.reply});
 return cases;
}
