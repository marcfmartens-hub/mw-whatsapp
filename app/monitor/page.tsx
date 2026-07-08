"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Conv {
  phone: string;
  step: number;
  name: string | null;
  make: string | null;
  model: string | null;
  year: string | null;
  mileage: string | null;
  specs: string | null;
  loan: string | null;
  sell_timeline: string | null;
  appointment: string | null;
  appointment_date: string | null;
  appointment_time: string | null;
  last_message_at: string | null;
  messages: Message[] | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function stepLabel(step: number): string {
  const labels: Record<number, string> = {
    0: "New",
    1: "Name",
    2: "Phone",
    3: "Car info",
    4: "Mileage/Specs",
    5: "Loan",
    6: "Timeline",
    7: "Appointment",
    8: "Complete ✓",
  };
  return labels[step] ?? `Step ${step}`;
}

function stepColor(step: number): string {
  if (step === 0) return "#8696a0";
  if (step <= 2) return "#f59e0b";
  if (step <= 5) return "#3b82f6";
  if (step === 7) return "#a855f7";
  if (step >= 8) return "#25d366";
  return "#8696a0";
}

function avatarInitial(conv: Conv): string {
  if (conv.name) return conv.name[0].toUpperCase();
  const digits = conv.phone.replace(/\D/g, "");
  return digits.slice(-2);
}

function avatarColor(phone: string): string {
  const colors = ["#d97706","#059669","#7c3aed","#dc2626","#0284c7","#ea580c","#16a34a","#be185d","#0891b2","#65a30d"];
  let hash = 0;
  for (const ch of phone) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffffff;
  return colors[Math.abs(hash) % colors.length];
}

function lastPreview(conv: Conv): string {
  const msgs = conv.messages;
  if (!msgs || msgs.length === 0) return "No messages yet";
  const last = msgs[msgs.length - 1];
  return last.content.replace(/\n/g, " ").slice(0, 55) + (last.content.length > 55 ? "…" : "");
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function MonitorPage() {
  const [convs, setConvs] = useState<Conv[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "complete">("all");
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef<Record<string, number>>({});

  const fetchConvs = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations", { cache: "no-store" });
      if (!res.ok) return;
      const data: Conv[] = await res.json();
      setConvs(data);
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConvs();
    const id = setInterval(fetchConvs, 5000);
    return () => clearInterval(id);
  }, [fetchConvs]);

  // Auto-scroll when new messages arrive for the active conversation
  useEffect(() => {
    const activeConv = convs.find((c) => c.phone === active);
    if (!activeConv) return;
    const newLen = activeConv.messages?.length ?? 0;
    const prevLen = prevLengthRef.current[active ?? ""] ?? 0;
    if (newLen > prevLen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevLengthRef.current[active ?? ""] = newLen;
  }, [convs, active]);

  const filtered = convs.filter((c) => {
    const matchSearch =
      c.phone.includes(search) ||
      (c.name ?? "").toLowerCase().includes(search.toLowerCase());
    const matchFilter =
      filter === "all" ||
      (filter === "complete" && c.step >= 8) ||
      (filter === "active" && c.step < 8);
    return matchSearch && matchFilter;
  });

  const activeConv = convs.find((c) => c.phone === active) ?? null;

  return (
    <div style={S.app}>
      {/* ── SIDEBAR ── */}
      <div style={S.sidebar}>
        {/* Header */}
        <div style={S.sideHeader}>
          <div style={S.botRow}>
            <div style={S.botAvatar}>🤖</div>
            <div>
              <div style={S.botName}>WhatsApp AI Bot</div>
              <div style={S.botSub}>
                <span style={S.dot} />
                Kaya · Mister Wheelz
              </div>
            </div>
          </div>
          <div style={S.convCount}>{convs.length}</div>
        </div>

        {/* Search */}
        <div style={S.searchWrap}>
          <div style={S.searchBox}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8696a0" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              style={S.searchInput}
              placeholder="Search by phone or name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Filter chips */}
        <div style={S.chips}>
          {(["all", "active", "complete"] as const).map((f) => (
            <button
              key={f}
              style={{ ...S.chip, ...(filter === f ? S.chipActive : S.chipInactive) }}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : f === "active" ? "In progress" : "Complete"}
            </button>
          ))}
        </div>

        {/* Contact list */}
        <div style={S.contactList}>
          {loading && (
            <div style={S.emptyMsg}>Loading conversations…</div>
          )}
          {!loading && filtered.length === 0 && (
            <div style={S.emptyMsg}>No conversations found</div>
          )}
          {filtered.map((c) => (
            <div
              key={c.phone}
              style={{ ...S.contactItem, ...(active === c.phone ? S.contactActive : {}) }}
              onClick={() => setActive(c.phone)}
            >
              <div style={{ ...S.avatar, background: avatarColor(c.phone) }}>
                {avatarInitial(c)}
              </div>
              <div style={S.contactInfo}>
                <div style={S.contactTop}>
                  <div style={S.contactPhone}>
                    {c.name ? (
                      <>
                        <span style={S.contactName}>{c.name}</span>
                        <span style={S.contactPhoneSub}> · {c.phone}</span>
                      </>
                    ) : c.phone}
                  </div>
                  <div style={S.contactTime}>{relativeTime(c.last_message_at)}</div>
                </div>
                <div style={S.contactBottom}>
                  <div style={S.contactPreview}>{lastPreview(c)}</div>
                  <div style={{ ...S.stepBadge, background: stepColor(c.step) }}>
                    {stepLabel(c.step)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── CHAT PANEL ── */}
      <div style={S.chatPanel}>
        {!activeConv ? (
          <div style={S.emptyState}>
            <div style={S.emptyIcon}>🤖</div>
            <div style={S.emptyTitle}>WhatsApp AI Bot — Kaya</div>
            <div style={S.emptySub}>
              Select a conversation to view Kaya&rsquo;s messages with a customer.
              <br />Auto-refreshes every 5 seconds.
            </div>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div style={S.chatHeader}>
              <div style={{ ...S.avatar, background: avatarColor(activeConv.phone), width: 42, height: 42, fontSize: 16, flexShrink: 0 }}>
                {avatarInitial(activeConv)}
              </div>
              <div style={S.chatHeaderInfo}>
                <div style={S.chatHeaderName}>
                  {activeConv.name ? `${activeConv.name} · ` : ""}{activeConv.phone}
                </div>
                <div style={S.chatHeaderStatus}>
                  <span style={S.dot} />
                  {stepLabel(activeConv.step)} · step {activeConv.step}/8
                </div>
              </div>
              {/* Known fields pill row */}
              <div style={S.fieldPills}>
                {activeConv.make && <span style={S.pill}>{activeConv.make}</span>}
                {activeConv.model && <span style={S.pill}>{activeConv.model}</span>}
                {activeConv.year && <span style={S.pill}>{activeConv.year}</span>}
                {activeConv.mileage && <span style={S.pill}>{Number(activeConv.mileage).toLocaleString()} km</span>}
                {activeConv.specs && <span style={S.pill}>{activeConv.specs}</span>}
                {activeConv.loan && <span style={S.pill}>Loan: {activeConv.loan}</span>}
                {activeConv.appointment_date && (
                  <span style={{ ...S.pill, background: "#a855f720", color: "#a855f7" }}>
                    📅 {activeConv.appointment_date} {activeConv.appointment_time ?? ""}
                  </span>
                )}
              </div>
            </div>

            {/* Messages */}
            <div style={S.messagesWrap}>
              <div style={S.dateDivider}>
                <div style={S.dateLabel}>Kaya conversation</div>
              </div>

              {(!activeConv.messages || activeConv.messages.length === 0) && (
                <div style={S.noMsgs}>No messages yet in this conversation.</div>
              )}

              {(activeConv.messages ?? []).map((msg, i) => {
                const isBot = msg.role === "assistant";
                return (
                  <div key={i} style={{ ...S.msgRow, justifyContent: isBot ? "flex-start" : "flex-end" }}>
                    <div style={isBot ? S.bubbleIn : S.bubbleOut}>
                      {isBot && (
                        <div style={S.senderTag}>🤖 Kaya</div>
                      )}
                      <div style={S.msgText}>
                        {msg.content.split("\n").map((line, j) => (
                          <span key={j}>{line}{j < msg.content.split("\n").length - 1 ? <br /> : null}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Read-only footer */}
            <div style={S.inputBar}>
              <div style={S.readonlyNote}>
                👁 Read-only monitor — Kaya handles all replies automatically
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  app: {
    display: "flex",
    width: "100vw",
    height: "100vh",
    background: "#111b21",
    overflow: "hidden",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
  },

  // Sidebar
  sidebar: {
    width: 380,
    minWidth: 380,
    display: "flex",
    flexDirection: "column",
    background: "#111b21",
    borderRight: "1px solid #222d34",
    overflow: "hidden",
  },
  sideHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 16px",
    background: "#202c33",
    minHeight: 59,
    flexShrink: 0,
  },
  botRow: { display: "flex", alignItems: "center", gap: 12 },
  botAvatar: {
    width: 40, height: 40, borderRadius: "50%",
    background: "linear-gradient(135deg,#25d366,#128c7e)",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 18, flexShrink: 0,
  },
  botName: { color: "#e9edef", fontSize: 17, fontWeight: 600 },
  botSub: { color: "#8696a0", fontSize: 12, marginTop: 1, display: "flex", alignItems: "center", gap: 4 },
  dot: { width: 7, height: 7, borderRadius: "50%", background: "#25d366", display: "inline-block" },
  convCount: {
    background: "#00a884", color: "#111b21", borderRadius: 12,
    padding: "2px 8px", fontSize: 13, fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
  },

  searchWrap: { padding: "8px 12px", background: "#111b21", flexShrink: 0 },
  searchBox: {
    display: "flex", alignItems: "center", gap: 10,
    background: "#202c33", borderRadius: 8, padding: "7px 12px",
  },
  searchInput: {
    background: "transparent", border: "none", outline: "none",
    color: "#e9edef", fontSize: 15, width: "100%",
  },

  chips: { display: "flex", gap: 8, padding: "4px 12px 8px", flexShrink: 0 },
  chip: { padding: "5px 12px", borderRadius: 20, fontSize: 13, fontWeight: 500, cursor: "pointer", border: "none" },
  chipActive: { background: "#00a884", color: "#111b21" },
  chipInactive: { background: "#222d34", color: "#8696a0" },

  contactList: { flex: 1, overflowY: "auto" },
  contactItem: {
    display: "flex", alignItems: "center", padding: "10px 16px", gap: 12,
    cursor: "pointer", borderBottom: "1px solid #1a2730", transition: "background 0.1s",
  },
  contactActive: { background: "#2a3942" },

  avatar: {
    width: 49, height: 49, borderRadius: "50%", display: "flex",
    alignItems: "center", justifyContent: "center", fontSize: 18,
    fontWeight: 700, color: "#fff", flexShrink: 0,
    fontVariantNumeric: "tabular-nums",
  },
  contactInfo: { flex: 1, minWidth: 0 },
  contactTop: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 },
  contactPhone: { color: "#e9edef", fontSize: 16, fontWeight: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  contactName: { fontWeight: 600 },
  contactPhoneSub: { color: "#8696a0", fontSize: 13 },
  contactTime: { color: "#8696a0", fontSize: 12, whiteSpace: "nowrap", flexShrink: 0, marginLeft: 8 },
  contactBottom: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 },
  contactPreview: { color: "#8696a0", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 },
  stepBadge: {
    color: "#fff", borderRadius: 10, padding: "2px 7px",
    fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0,
  },
  emptyMsg: { color: "#8696a0", textAlign: "center", padding: "32px 16px", fontSize: 14 },

  // Chat panel
  chatPanel: {
    flex: 1, display: "flex", flexDirection: "column",
    background: "#0b141a", overflow: "hidden", position: "relative",
  },
  emptyState: {
    flex: 1, display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", gap: 16,
  },
  emptyIcon: {
    width: 160, height: 160, borderRadius: "50%",
    background: "#202c33", display: "flex", alignItems: "center",
    justifyContent: "center", fontSize: 64, border: "2px solid #222d34",
  },
  emptyTitle: { color: "#e9edef", fontSize: 26, fontWeight: 300 },
  emptySub: { color: "#8696a0", fontSize: 14, textAlign: "center", lineHeight: 1.7 },

  chatHeader: {
    display: "flex", alignItems: "center", padding: "10px 16px",
    background: "#202c33", minHeight: 59, gap: 12, flexShrink: 0,
    flexWrap: "wrap",
  },
  chatHeaderInfo: { flex: 1, minWidth: 0 },
  chatHeaderName: { color: "#e9edef", fontSize: 17, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  chatHeaderStatus: { color: "#8696a0", fontSize: 13, marginTop: 2, display: "flex", alignItems: "center", gap: 5 },
  fieldPills: { display: "flex", flexWrap: "wrap", gap: 5 },
  pill: {
    background: "#2a3942", color: "#8696a0", borderRadius: 10,
    padding: "3px 9px", fontSize: 12, fontWeight: 500,
  },

  messagesWrap: {
    flex: 1, overflowY: "auto", padding: "12px 8%",
    display: "flex", flexDirection: "column", gap: 4,
  },
  dateDivider: { display: "flex", justifyContent: "center", margin: "8px 0" },
  dateLabel: {
    background: "#182229", color: "#8696a0", fontSize: 12.5,
    padding: "5px 12px", borderRadius: 8, fontWeight: 500,
  },
  noMsgs: { color: "#8696a0", textAlign: "center", padding: 32, fontSize: 14 },

  msgRow: { display: "flex", alignItems: "flex-end", gap: 6 },
  bubbleOut: {
    maxWidth: "65%", padding: "7px 12px 7px 12px", borderRadius: "7.5px 2px 7.5px 7.5px",
    background: "#005c4b", color: "#e9edef",
    boxShadow: "0 1px 1px rgba(0,0,0,.25)",
  },
  bubbleIn: {
    maxWidth: "65%", padding: "7px 12px 7px 12px", borderRadius: "2px 7.5px 7.5px 7.5px",
    background: "#202c33", color: "#e9edef",
    boxShadow: "0 1px 1px rgba(0,0,0,.25)",
  },
  senderTag: { color: "#00a884", fontSize: 12.5, fontWeight: 700, marginBottom: 3 },
  msgText: { fontSize: 14.5, lineHeight: 1.55 },

  inputBar: {
    background: "#202c33", padding: "14px 20px",
    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  readonlyNote: { color: "#8696a0", fontSize: 13 },
};
