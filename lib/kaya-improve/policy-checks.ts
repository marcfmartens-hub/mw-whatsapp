import {LOCATION_TEXT,CUSTOMER_CALL_CHOICE} from "./contact";
/** Exact owner-approved contact response; asking a choice is not callback consent. */
export function approvedContactReply(reply:string){return reply===`${LOCATION_TEXT}\n${CUSTOMER_CALL_CHOICE}`||reply===`${LOCATION_TEXT}\n[SPLIT]\n${CUSTOMER_CALL_CHOICE}`||reply===LOCATION_TEXT;}
/** Fixture-specific check: a conditional 75,000 request is never accepted or booked. */
export function conditionalPriceReply(reply:string){
 const noAcceptance=!/\b(?:agreed|deal|we accept|we(?:'ll| will) pay|we offer|you'?re booked|booking is confirmed)\b/i.test(reply);
 const noQuote=!/\b75(?:[ ,]?000|k)\b/i.test(reply);
 return noAcceptance&&noQuote&&/\bprice\b/i.test(reply)&&/\binspection\b/i.test(reply);
}
