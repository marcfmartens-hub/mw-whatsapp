export const RUNS = [
  { id: "confirmation", name: "Confirmation Audit", description: "Audit booking and callback evidence. Existing booking rules always apply.", defaultMode: "event", defaultMinutes: 0, recommended: "After each saved reply (recommended)" },
  { id: "reply", name: "Reply Check", description: "Check each saved reply for repetition, context and communication problems.", defaultMode: "event", defaultMinutes: 0, recommended: "After each saved reply (recommended)" },
  { id: "outcome", name: "Conversation Outcome", description: "Classify the conversation after a saved reply, including chats never pushed to Bigin. Silence alone is not a failure.", defaultMode: "event", defaultMinutes: 0, recommended: "After each saved reply (recommended)" },
  { id: "review", name: "Detailed Review", description: "Review flagged chats and collect suggested corrections and proposals.", defaultMode: "interval", defaultMinutes: 60, recommended: "Next Bigin push, at most hourly (recommended)" },
  { id: "regression", name: "Improvement & Regression", description: "Group recurring issues and test the detector against successful and difficult fixtures. Auto approval uses its own validation and publishing gate.", defaultMode: "interval", defaultMinutes: 1440, recommended: "Next Bigin push, at most daily (recommended)" },
] as const;
export type RunId = typeof RUNS[number]["id"];
export type Schedule = { mode: "event" | "interval" | "off"; minutes: number };
export interface ImproveConfig { enabled: boolean; autoApprove: boolean; schedules: Record<RunId, Schedule> }
export const DEFAULT_CONFIG: ImproveConfig = { enabled: false, autoApprove: false, schedules: Object.fromEntries(RUNS.map(r => [r.id, { mode: r.defaultMode, minutes: r.defaultMinutes }])) as ImproveConfig["schedules"] };
export function validateConfig(value: unknown): ImproveConfig {
  const c = value as ImproveConfig;
  if (!c || typeof c.enabled !== "boolean" || !c.schedules) throw new Error("Invalid settings");
  const schedules = {} as ImproveConfig["schedules"];
  for (const r of RUNS) {
    const s = c.schedules[r.id];
    if (!s || !["event", "interval", "off"].includes(s.mode)) throw new Error(`Invalid schedule: ${r.name}`);
    if (!Number.isInteger(s.minutes) || s.minutes < 0 || s.minutes > 43200 || (s.mode === "interval" && s.minutes < 1)) throw new Error("Custom interval must be 1–43,200 whole minutes");
    schedules[r.id] = { mode: s.mode, minutes: s.minutes };
  }
  if(c.autoApprove !== undefined && typeof c.autoApprove !== "boolean") throw new Error("Invalid auto-approval setting");
  return { enabled: c.enabled, autoApprove: c.autoApprove ?? false, schedules };
}
export function nextRun(config: ImproveConfig, id: RunId, last: string | null): string | null {
  const s = config.schedules[id];
  if (!config.enabled || s.mode !== "interval" || !last) return null;
  return new Date((last ? Date.parse(last) : Date.now()) + s.minutes * 60000).toISOString();
}
