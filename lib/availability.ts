// Interpret a visit window separately from when the owner wants to sell.
// `nowDubai` is a clock shifted to Dubai time; use UTC accessors on it.
export function visitAvailability(message: string, nowDubai = new Date(Date.now() + 4 * 3600e3)):
  { date?: string; reply: string } | null {
  const t = message.toLowerCase();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const plus = (n: number) => new Date(nowDubai.getTime() + n * 86400e3);
  const nextOpen = (n: number) => { let d = plus(n); while (d.getUTCDay() === 0) d = new Date(d.getTime() + 86400e3); return d; };
  const label = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const saturday = (next = false) => {
    let n = (6 - nowDubai.getUTCDay() + 7) % 7;
    if (next && nowDubai.getUTCDay() !== 0 || n === 0 && nowDubai.getUTCHours() >= 18) n += 7;
    return plus(n);
  };
  if (/\b(?:can only|only able to|cannot|can'?t|no time).*\b(?:come|visit|bring).*\bnext week\b|\b(?:come|visit|bring)\b.*\bonly next week\b/i.test(t))
    return { reply: "No problem. We can arrange the inspection next week. Which day next week suits you?" };
  if (/\b(?:after|once|following) (?:the |this )?week\s*-?\s*end\b/i.test(t)) {
    const mon = nowDubai.getUTCDay() === 0 ? plus(1) : new Date(saturday().getTime() + 2 * 86400e3);
    return { reply: `No problem. ${label(mon)} or later works. Which day would suit you?` };
  }
  if (/\bnext week\s*-?\s*end\b/i.test(t)) {
    const d = saturday(true);
    return { date: iso(d), reply: `No problem, ${label(d)} works. What time is best for you to bring the car?` };
  }
  if (/\b(?:no time|can'?t|cannot|not available|busy|only available|only free)\b.*\b(?:before|until) (?:the |this )?week\s*-?\s*end\b/i.test(t)) {
    const d = saturday();
    return { reply: `No problem. ${label(d)} or later works. Which day would suit you?` };
  }
  if (/\bbefore (?:the |this )?week\s*-?\s*end\b.*\bnot today\b/i.test(t))
    return { reply: "No problem. Which day before the weekend works for you?" };
  if (/\b(?:the )?day after tomorrow\b/i.test(t)) {
    const d = nextOpen(2);
    return { date: iso(d), reply: `No problem, ${label(d)} works. What time is best for you to bring the car${d.getUTCDay() === 5 ? "? We open at 12 PM on Friday." : "?"}` };
  }
  if (/\bafter tomorrow\b|\bnot tomorrow\b/i.test(t)) {
    const d = nextOpen(2);
    return { reply: `No problem. ${label(d)} or later works. Which day would suit you?` };
  }
  if (/\bnot today\b|\btoday (?:is )?not (?:possible|good|convenient)\b/i.test(t)) {
    const d = nextOpen(1);
    return { reply: `No problem. ${label(d)} or later works. Which day would suit you?` };
  }
  if (/\b(?:this )?week\s*-?\s*end\b/i.test(t)) {
    const d = saturday();
    return { date: iso(d), reply: `No problem, ${label(d)} works. What time is best for you to bring the car?` };
  }
  return null;
}
