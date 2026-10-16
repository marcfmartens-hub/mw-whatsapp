import {learnedMessage,Learning} from "./learning";
export const LOCATION_TEXT = `📍 *Mister Wheelz Car Buyers*
Umm Suqeim Branch, Al Quoz 4, Dubai
https://maps.app.goo.gl/nv6Yy7uKqVCnkcVx6

🕙 Mon–Sat 10 AM – 7 PM (Fri from 12 PM), Sun closed
📞 +971 58 582 5543
📄 Please bring your Emirates ID and Mulkiya`;
export const CUSTOMER_CALL_CHOICE = "Would you like to continue with the booking, or would you like our team to call you? You can also call us on the number above whenever you're ready.";
export function wantsOurNumber(text: string, learning?:Learning): boolean {
  text = learnedMessage(text,learning);
  return /\b(?:send|share|give|text)\s+me\s+(?:(?:your|the|a)\s+)?(?:phone|contact|mobile|customer service\s+)?number\b|\b(?:what(?:'s| is)|which|do you have)\s+(?:your|the|a)\s+(?:phone|contact|mobile|customer service\s+)?number\b|\b(?:how|where)\s+(?:can|do)\s+i\s+(?:call|phone|reach|contact)\s+you\b|\b(?:i\s*(?:will|can|want to|would like to|am going to)|i'?ll|i'?m|im)\s+(?:call|phone|ring|contact)\s+you\b|\b(?:number|phone number)\s+(?:to|i can)\s+call\b/i.test(text);
}
