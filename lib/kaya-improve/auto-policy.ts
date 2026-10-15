export const AUTO_POLICY={version:"2026-10-15-v1",allowedPath:"lib/kaya-improve/learning.json",dailyMinorHours:24,maxBatch:5,
 locked:["Cars and related sale services only; never politics, religion or unrelated topics","Pricing and sales promises","Booking consent, availability and fallback times","Specs and Mulkiya decisions","Cancellation and rescheduling actions","Bigin record/task creation and duplication","Stop requests and callback consent","Business location, hours, services and contact number","Authentication, permissions, backups and approval rules"],
 scope:"Add exact English contact-language aliases only. No arbitrary code, prompt instructions, new names, booking actions or business-policy edits."} as const;
export function releaseDue(severity:"critical"|"minor",lastMinor:string|null,now=Date.now()) {return severity==="critical"||!lastMinor||now-Date.parse(lastMinor)>=24*3600e3;}
export function checkPublishGate(input:{enabled:boolean;hasBackup:boolean;validated:boolean;ci:boolean;preview:boolean;baseMatches:boolean;files:string[]}) {
 if(!input.enabled||!input.hasBackup||!input.validated||!input.ci||!input.preview||!input.baseMatches)throw Error("Release gate has not passed");
 if(input.files.length!==2||![AUTO_POLICY.allowedPath,"lib/kaya-improve/history.json"].every(p=>input.files.includes(p)))throw Error("Release touches a locked file");
 return true;
}
