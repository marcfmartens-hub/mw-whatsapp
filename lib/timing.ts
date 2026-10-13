// How a customer answers "when?" when it isn't a clear day + time (Marc, 13 Oct):
//  A undecided ("I'll let you know") · B vague window ("later this week") · C location only
//  D walk-in ("I'll pass by") · E depends on someone ("check with my wife") · F day with doubt
//  ("Saturday maybe") · G far away ("after Eid", "next month", ≥ 1 week)
export type TimingKind = "A" | "B" | "C" | "D" | "E" | "F" | "G";

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_RE = /\b(today|tonight|tomorrow|tmrw|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat)\b|\b\d{1,2}(st|nd|rd|th)?\s*(of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;
const TIME_RE = /\b\d{1,2}(:\d{2})?\s*(am|pm)\b|\b\d{1,2}:\d{2}\b/i;
// Next Eid (approximate; update when the date is announced)
const NEXT_EID = "2027-03-10";

const dubaiNow = () => new Date(Date.now() + 4 * 3600e3);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400e3);

export interface Timing { kind: TimingKind; day?: string; followUp?: string; options?: string[] }

export function classifyTiming(text: string, deferPattern: RegExp): Timing | null {
  const t = text.trim();
  const hasDay = DAY_RE.test(t);
  const hasTime = TIME_RE.test(t);
  const now = dubaiNow();

  // G — far away (only when it's at least a week out)
  const far = farDate(t, now);
  if (far) {
    const minFollow = iso(addDays(now, 7));
    if (far.target >= minFollow) {
      const follow = iso(addDays(new Date(far.target + "T12:00:00Z"), -2));
      return { kind: "G", followUp: follow < minFollow ? minFollow : follow };
    }
  }
  // E — depends on someone / something
  if (/\b(check|ask|discuss|confirm|talk)\s+(it\s+)?(with|to)\s+(my\s+)?(wife|husband|boss|family|brother|sister|father|dad|mother|mom|partner|son|friend|manager|company)\b|\bwhen my \w+ (is back|comes back|returns|arrives)\b|\b(after|once|when) the car (is|comes) back\b/i.test(t) && !hasTime)
    return { kind: "E" };
  // F — a day, but with doubt
  const dayWord = t.match(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday)\b/i)?.[1]?.toLowerCase();
  if (dayWord && !hasTime && /\b(maybe|may be|probably|might|perhaps|possibly|try to|i think|not sure)\b/i.test(t))
    return { kind: "F", day: dayWord };
  // Two days ("On 16th or 17th Oct", "Friday or Saturday") → offer the earliest one (Marc, 13 Oct)
  if (!hasTime) {
    const MON = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    const dd = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:or|\/|&|and)\s*(\d{1,2})(?:st|nd|rd|th)?\b(?:\s*(?:of\s*)?([a-z]{3})[a-z]*)?/i);
    if (dd && +dd[1] >= 1 && +dd[1] <= 31) {
      const a = Math.min(+dd[1], +dd[2]);
      let mon = dd[3] && MON.includes(dd[3].toLowerCase()) ? dd[3].toLowerCase() : null;
      if (!mon) mon = MON[a >= now.getUTCDate() ? now.getUTCMonth() : (now.getUTCMonth() + 1) % 12];
      return { kind: "F", day: `${a} ${mon}` };
    }
    const DAYS = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
    const wd = t.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b\s*(?:or|\/)\s*\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
    if (wd) {
      const ahead = (w: string) => (DAYS.indexOf(w.toLowerCase()) - now.getUTCDay() + 7) % 7;
      const pick = [wd[1], wd[2]].filter(w => w.toLowerCase() !== "sunday").sort((x, y) => ahead(x) - ahead(y))[0];
      if (pick) return { kind: "F", day: pick.toLowerCase() };
    }
  }
  if (hasDay || hasTime) return null;   // a clear day or time → the normal booking flow
  // C — wants the location
  if (/\b(send|share|give|drop)( me)? (the |your )?(location|address|pin|map)\b|\bwhere (are you|is (the|your) (branch|office|showroom))\b|\b(location|address) (please|pls)\b|^\s*location\??\s*$/i.test(t))
    return { kind: "C" };
  // D — walk-in
  if (/\b(pass by|walk[\s-]?in|drop by|swing by|come (when|whenever) i'?m free|come any ?time|just come|i'?ll come when i can)\b/i.test(t))
    return { kind: "D" };
  // B — vague window this / next week
  const w = vagueWindow(t, now);
  if (w) return { kind: "B", options: w };
  // A — undecided
  if (deferPattern.test(t) || /\b(i'?ll|i will) (let (you|u) know|tell (you|u)) when\b|\bwhen i come\b|\bnot sure (when|yet)\b|\bwill (decide|see)\b/i.test(t))
    return { kind: "A" };
  return null;
}

function farDate(t: string, now: Date): { target: string } | null {
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  if (/\b(after|post)\s+eid\b|\beid\b/i.test(t)) return { target: NEXT_EID };
  if (/\bnext month\b|\bin a month\b|\bin one month\b/i.test(t)) return { target: iso(new Date(Date.UTC(y, m + 1, 1))) };
  if (/\bend of (the |this )?month\b/i.test(t)) return { target: iso(new Date(Date.UTC(y, m + 1, 0))) };
  if (/\bnext year\b/i.test(t)) return { target: iso(new Date(Date.UTC(y + 1, 0, 5))) };
  const wk = t.match(/\b(?:in|after)\s+(two|2|three|3|four|4|five|5|six|6|a few|few|couple of)\s+weeks?\b/i);
  if (wk) { const n = ({ two: 2, three: 3, four: 4, five: 5, six: 6, "a few": 3, few: 3, "couple of": 2 } as Record<string, number>)[wk[1].toLowerCase()] ?? +wk[1]; return { target: iso(addDays(now, n * 7)) }; }
  if (/\bafter next week\b|\bweek after next\b/i.test(t)) { const toMon = ((8 - now.getUTCDay()) % 7) || 7; return { target: iso(addDays(now, toMon + 7)) }; }
  if (/\bafter (my |the )?(vacation|holiday|holidays|leave|trip|summer|ramadan)\b/i.test(t)) return { target: iso(addDays(now, 14)) };
  return null;
}

// Two concrete days inside a vague window, e.g. "later this week" → ["Thursday", "Saturday"]
function vagueWindow(t: string, now: Date): string[] | null {
  const dow = now.getUTCDay();
  let days: number[] = [];
  if (/\bnext week\b/i.test(t)) days = [8 - dow, 8 - dow + 1, 8 - dow + 2, 8 - dow + 3, 8 - dow + 4, 8 - dow + 5].map(n => n % 7 === 0 ? n : n); // Mon..Sat next week (offsets)
  else if (/\b(later|sometime|maybe)\s+(this )?week\b|\bthis week sometime\b|\bend of (the )?week\b|\b(in )?(a )?few days\b|\bcoming days\b|\bafter (my )?salary\b|\bthis week\b/i.test(t)) {
    for (let n = 1; n <= 6; n++) { const d = (dow + n) % 7; if (d === 0) break; days.push(n); }
    if (!days.length) days = [2, 3, 4, 5, 6, 7].filter(n => (dow + n) % 7 !== 0); // Saturday today → next week
  } else return null;
  const names = days.map(n => DAYS[(dow + n) % 7]).filter(d => d !== "sunday");
  if (!names.length) return null;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  if (names.length === 1) return [cap(names[0])];
  // a weekday in the middle + Saturday (or the last day of the window)
  const mid = names[Math.min(names.length - 2, Math.max(0, Math.floor((names.length - 1) / 2)))];
  return [cap(mid), cap(names[names.length - 1])];
}
