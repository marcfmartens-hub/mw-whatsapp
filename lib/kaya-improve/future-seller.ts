/**
 * Deterministic future-seller / valuation-intent guard.
 * Never quotes a value, never books without consent and never changes a booking.
 */
export const PRICE_CONCERN = /\b(?:how much|price|prive|worth|valuation|value|estimate|offer|quote|figure|ballpark)\b/i;
const FUTURE = /\b(?:in\s+(?:november|december|january|february|march|april|may|june|july|august|september|october)|next\s+(?:month|year)|in\s+\d+\s+(?:weeks?|months?)|after\s+\d+\s+(?:weeks?|months?)|in\s+(?:a|couple of|few|several)\s+(?:weeks?|months?)|not\s+(?:selling|ready)\s+(?:now|yet)|later\s+this\s+year|towards?\s+the\s+end\s+of\s+the\s+year)\b/i;
const NOW = /\b(?:sell|selling|book|inspection|bring|come)\b.{0,65}\b(?:today|tomorrow|this\s+week|right\s+now|asap|immediately)\b|\b(?:today|tomorrow|this\s+week|right\s+now|asap|immediately)\b.{0,65}\b(?:sell|selling|book|inspection|bring|come)\b/i;
export function futureSellerPriceInquiry(text:string,previous:string[],alreadyConsulting=false){
 const history=[...previous,text].join("\n");
 const future=FUTURE.test(history);
 const price=PRICE_CONCERN.test(text)||alreadyConsulting&&PRICE_CONCERN.test(history);
 return future&&price&&!NOW.test(text);
}
export function explicitVisitRequest(text:string){
 return /\b(?:book|arrange|schedule|come|bring|visit|inspection)\b.{0,60}\b(?:today|tomorrow|this week|monday|tuesday|wednesday|thursday|friday|saturday|\d{1,2}\s*(?:am|pm))\b|\b(?:today|tomorrow|this week)\b.{0,40}\b(?:book|visit|come|inspection)\b/i.test(text);
}
export function refusesVisitForPrice(text:string){
 return /(?:don'?t|do not|won'?t|will not|can'?t|cannot|not going to|no way).{0,85}(?:come|visit|bring|inspection|trip|without knowing|until i know)|(?:without|before).{0,65}(?:know|price|estimate|value)|(?:want|need).{0,50}(?:price|value|estimate).{0,50}(?:first|before)/i.test(text);
}
export function saleMethod(text:string):"Cash Deal"|"Consignment"|null {
 if(/\b(?:consign|consignment)\b/i.test(text))return "Consignment";
 if(/\b(?:cash sale|cash deal|direct sale|direct purchase|sell directly|sell to you)\b/i.test(text))return "Cash Deal";
 return null;
}
export function missingCarDetails(car:{make?:string;model?:string;year?:string;mileage?:string;specs?:string}):string[]{
 const missing:string[]=[];
 if(!car.make||!car.model||!car.year)missing.push("make, model and year");
 if(!car.mileage)missing.push("mileage");
 if(!car.specs)missing.push("GCC/non-GCC specifications");
 return missing;
}
export function uaeNumber(value:string):boolean {
 const digits=value.replace(/\D/g,"");
 return /^9715\d{8}$/.test(digits)||/^05\d{8}$/.test(digits);
}
export function numberFromMessage(value:string):string|null {
 const match=value.match(/(?:\+?971[\s-]?5\d(?:[\s-]?\d){7}|\b05\d(?:[\s-]?\d){7})/);
 return match?match[0].replace(/[\s-]/g,""):null;
}
export const METHOD_EXPLANATION = [
 "We offer two ways to sell your car:",
 "🚗 *Direct Cash Sale* — After a free inspection and agreeing on a price, we can buy your car and pay the same day.",
 "🤝 *Free Consignment* — We help market your car to buyers. This may achieve a better price, but it can take longer.",
 "The price depends on the car's condition and the selling method. We can't confirm a final purchase price without inspection."
].join("\\n\\n");
