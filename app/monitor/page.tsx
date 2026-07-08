"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Message { role: "user" | "assistant"; content: string; }

interface Conv {
  phone: string; step: number; name: string | null;
  make: string | null; model: string | null; year: string | null;
  mileage: string | null; specs: string | null; loan: string | null;
  sell_timeline: string | null; appointment: string | null;
  appointment_date: string | null; appointment_time: string | null;
  last_message_at: string | null; messages: Message[] | null;
}

interface LoginRecord { id: number; username: string; ip: string; user_agent: string; logged_in_at: string; }
interface UserRecord  { username: string; created_at: string; }

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

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function stepLabel(step: number): string {
  return ["New","Name","Phone","Car info","Mileage/Specs","Loan","Timeline","Appointment","Complete ✓"][step] ?? `Step ${step}`;
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
  return conv.phone.replace(/\D/g, "").slice(-2);
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

// ── Settings Panel ─────────────────────────────────────────────────────────────

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [tab, setTab] = useState<"history" | "users">("history");
  const [logins, setLogins] = useState<LoginRecord[]>([]);
  const [users, setUsers]   = useState<UserRecord[]>([]);
  const [newUser, setNewUser] = useState({ username: "", password: "" });
  const [addError, setAddError] = useState("");
  const [addOk, setAddOk] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/monitor/users")
      .then((r) => r.json())
      .then((d) => { setLogins(d.logins ?? []); setUsers(d.users ?? []); setLoading(false); });
  }, []);

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    setAddError(""); setAddOk(false);
    const res = await fetch("/api/monitor/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newUser),
    });
    if (res.ok) {
      setAddOk(true);
      setNewUser({ username: "", password: "" });
      const d = await fetch("/api/monitor/users").then((r) => r.json());
      setUsers(d.users ?? []);
    } else {
      const d = await res.json();
      setAddError(d.error ?? "Failed to add user");
    }
  }

  async function handleLogout() {
    await fetch("/api/monitor/logout", { method: "POST" });
    router.push("/monitor/login");
  }

  // Parse browser from user agent
  function parseBrowser(ua: string): string {
    if (ua.includes("Chrome") && !ua.includes("Edg")) return "Chrome";
    if (ua.includes("Firefox")) return "Firefox";
    if (ua.includes("Safari") && !ua.includes("Chrome")) return "Safari";
    if (ua.includes("Edg")) return "Edge";
    return "Browser";
  }

  return (
    <div style={SP.overlay} onClick={onClose}>
      <div style={SP.panel} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={SP.header}>
          <div>
            <div style={SP.title}>⚙ Settings</div>
            <div style={SP.sub}>WhatsApp AI Bot · Kaya</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={SP.logoutBtn} onClick={handleLogout}>Sign out</button>
            <button style={SP.closeBtn} onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Tabs */}
        <div style={SP.tabs}>
          <button
            style={{ ...SP.tab, ...(tab === "history" ? SP.tabActive : SP.tabInactive) }}
            onClick={() => setTab("history")}
          >
            Login History
          </button>
          <button
            style={{ ...SP.tab, ...(tab === "users" ? SP.tabActive : SP.tabInactive) }}
            onClick={() => setTab("users")}
          >
            Users
          </button>
        </div>

        <div style={SP.body}>
          {loading && <div style={SP.dimText}>Loading…</div>}

          {/* Login History tab */}
          {!loading && tab === "history" && (
            <div>
              <div style={SP.sectionTitle}>Recent logins</div>
              {logins.length === 0 && <div style={SP.dimText}>No login history yet.</div>}
              <div style={SP.loginList}>
                {logins.map((l) => (
                  <div key={l.id} style={SP.loginRow}>
                    <div style={SP.loginAvatar}>{l.username[0].toUpperCase()}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={SP.loginName}>{l.username}
                        <span style={SP.loginBrowser}> · {parseBrowser(l.user_agent)}</span>
                      </div>
                      <div style={SP.loginMeta}>
                        <span style={SP.ipBadge}>🌐 {l.ip}</span>
                        <span style={SP.loginTime}>{fmtDate(l.logged_in_at)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Users tab */}
          {!loading && tab === "users" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              {/* Existing users */}
              <div>
                <div style={SP.sectionTitle}>Active users</div>
                <div style={SP.userList}>
                  {users.map((u) => (
                    <div key={u.username} style={SP.userRow}>
                      <div style={SP.loginAvatar}>{u.username[0].toUpperCase()}</div>
                      <div>
                        <div style={SP.loginName}>{u.username}</div>
                        <div style={SP.loginTime}>Added {fmtDate(u.created_at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Add new user */}
              <div>
                <div style={SP.sectionTitle}>Add new user</div>
                <form onSubmit={handleAddUser} style={SP.addForm}>
                  <input
                    style={SP.input}
                    placeholder="Username"
                    value={newUser.username}
                    onChange={(e) => setNewUser((p) => ({ ...p, username: e.target.value }))}
                    required
                  />
                  <input
                    style={SP.input}
                    type="password"
                    placeholder="Password"
                    value={newUser.password}
                    onChange={(e) => setNewUser((p) => ({ ...p, password: e.target.value }))}
                    required
                  />
                  {addError && <div style={SP.errMsg}>{addError}</div>}
                  {addOk   && <div style={SP.okMsg}>User added ✓</div>}
                  <button style={SP.addBtn} type="submit">Add user</button>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function MonitorPage() {
  const [convs, setConvs]       = useState<Conv[]>([]);
  const [active, setActive]     = useState<string | null>(null);
  const [search, setSearch]     = useState("");
  const [filter, setFilter]     = useState<"all"|"active"|"complete">("all");
  const [loading, setLoading]   = useState(true);
  const [settings, setSettings] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevLenRef = useRef<Record<string, number>>({});

  const fetchConvs = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations", { cache: "no-store" });
      if (!res.ok) return;
      setConvs(await res.json());
      setLoading(false);
    } catch { setLoading(false); }
  }, []);

  useEffect(() => { fetchConvs(); const id = setInterval(fetchConvs, 5000); return () => clearInterval(id); }, [fetchConvs]);

  useEffect(() => {
    const c = convs.find((c) => c.phone === active);
    if (!c) return;
    const newLen = c.messages?.length ?? 0;
    if (newLen > (prevLenRef.current[active!] ?? 0)) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    prevLenRef.current[active!] = newLen;
  }, [convs, active]);

  const filtered = convs.filter((c) => {
    const s = c.phone.includes(search) || (c.name ?? "").toLowerCase().includes(search.toLowerCase());
    const f = filter === "all" || (filter === "complete" && c.step >= 8) || (filter === "active" && c.step < 8);
    return s && f;
  });

  const activeConv = convs.find((c) => c.phone === active) ?? null;

  return (
    <div style={S.app}>
      {settings && <SettingsPanel onClose={() => setSettings(false)} />}

      {/* ── SIDEBAR ── */}
      <div style={S.sidebar}>
        <div style={S.sideHeader}>
          <div style={S.botRow}>
            <img src="/mw-logo.png" alt="Mister Wheelz" style={S.botAvatar} />
            <div>
              <div style={S.botName}>WhatsApp AI Bot</div>
              <div style={S.botSub}><span style={S.dot} />Kaya · Mister Wheelz</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={S.convCount}>{convs.length}</div>
            <button style={S.iconBtn} title="Settings" onClick={() => setSettings(true)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
          </div>
        </div>

        <div style={S.searchWrap}>
          <div style={S.searchBox}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8696a0" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input style={S.searchInput} placeholder="Search by phone or name" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        <div style={S.chips}>
          {(["all","active","complete"] as const).map((f) => (
            <button key={f} style={{ ...S.chip, ...(filter === f ? S.chipActive : S.chipInactive) }} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "active" ? "In progress" : "Complete"}
            </button>
          ))}
        </div>

        <div style={S.contactList}>
          {loading && <div style={S.emptyMsg}>Loading conversations…</div>}
          {!loading && filtered.length === 0 && <div style={S.emptyMsg}>No conversations found</div>}
          {filtered.map((c) => (
            <div key={c.phone} style={{ ...S.contactItem, ...(active === c.phone ? S.contactActive : {}) }} onClick={() => setActive(c.phone)}>
              <div style={{ ...S.avatar, background: avatarColor(c.phone) }}>{avatarInitial(c)}</div>
              <div style={S.contactInfo}>
                <div style={S.contactTop}>
                  <div style={S.contactPhone}>
                    {c.name ? <><span style={S.contactName}>{c.name}</span><span style={S.contactPhoneSub}> · {c.phone}</span></> : c.phone}
                  </div>
                  <div style={S.contactTime}>{relativeTime(c.last_message_at)}</div>
                </div>
                <div style={S.contactBottom}>
                  <div style={S.contactPreview}>{lastPreview(c)}</div>
                  <div style={{ ...S.stepBadge, background: stepColor(c.step) }}>{stepLabel(c.step)}</div>
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
            <img src="/mw-logo.png" alt="Mister Wheelz" style={S.emptyIcon} />
            <div style={S.emptyTitle}>WhatsApp AI Bot — Kaya</div>
            <div style={S.emptySub}>Select a conversation to view Kaya&rsquo;s messages.<br />Auto-refreshes every 5 seconds.</div>
          </div>
        ) : (
          <>
            <div style={S.chatHeader}>
              <div style={{ ...S.avatar, background: avatarColor(activeConv.phone), width: 42, height: 42, fontSize: 16, flexShrink: 0 }}>{avatarInitial(activeConv)}</div>
              <div style={S.chatHeaderInfo}>
                <div style={S.chatHeaderName}>{activeConv.name ? `${activeConv.name} · ` : ""}{activeConv.phone}</div>
                <div style={S.chatHeaderStatus}><span style={S.dot} />{stepLabel(activeConv.step)} · step {activeConv.step}/8</div>
              </div>
              <div style={S.fieldPills}>
                {activeConv.make && <span style={S.pill}>{activeConv.make}</span>}
                {activeConv.model && <span style={S.pill}>{activeConv.model}</span>}
                {activeConv.year && <span style={S.pill}>{activeConv.year}</span>}
                {activeConv.mileage && <span style={S.pill}>{Number(activeConv.mileage).toLocaleString()} km</span>}
                {activeConv.specs && <span style={S.pill}>{activeConv.specs}</span>}
                {activeConv.appointment_date && <span style={{ ...S.pill, background: "#a855f720", color: "#a855f7" }}>📅 {activeConv.appointment_date} {activeConv.appointment_time ?? ""}</span>}
              </div>
            </div>

            <div style={S.messagesWrap}>
              <div style={S.dateDivider}><div style={S.dateLabel}>Kaya conversation</div></div>
              {(!activeConv.messages || activeConv.messages.length === 0) && <div style={S.noMsgs}>No messages yet.</div>}
              {(activeConv.messages ?? []).map((msg, i) => {
                const isBot = msg.role === "assistant";
                return (
                  <div key={i} style={{ ...S.msgRow, justifyContent: isBot ? "flex-start" : "flex-end" }}>
                    <div style={isBot ? S.bubbleIn : S.bubbleOut}>
                      {isBot && <div style={S.senderTag}>🤖 Kaya</div>}
                      <div style={S.msgText}>
                        {msg.content.split("\n").map((line, j, arr) => (
                          <span key={j}>{line}{j < arr.length - 1 ? <br /> : null}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            <div style={S.inputBar}>
              <div style={S.readonlyNote}>👁 Read-only monitor — Kaya handles all replies automatically</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  app: { display:"flex", width:"100vw", height:"100vh", background:"#111b21", overflow:"hidden", fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif" },
  sidebar: { width:380, minWidth:380, display:"flex", flexDirection:"column", background:"#111b21", borderRight:"1px solid #222d34", overflow:"hidden" },
  sideHeader: { display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 16px", background:"#202c33", minHeight:59, flexShrink:0 },
  botRow: { display:"flex", alignItems:"center", gap:12 },
  botAvatar: { width:40, height:40, borderRadius:6, objectFit:"contain", flexShrink:0 },
  botName: { color:"#e9edef", fontSize:17, fontWeight:600 },
  botSub: { color:"#8696a0", fontSize:12, marginTop:1, display:"flex", alignItems:"center", gap:4 },
  dot: { width:7, height:7, borderRadius:"50%", background:"#25d366", display:"inline-block" },
  convCount: { background:"#00a884", color:"#111b21", borderRadius:12, padding:"2px 8px", fontSize:13, fontWeight:700 },
  iconBtn: { width:34, height:34, borderRadius:"50%", border:"none", background:"transparent", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", color:"#aebac1" },
  searchWrap: { padding:"8px 12px", background:"#111b21", flexShrink:0 },
  searchBox: { display:"flex", alignItems:"center", gap:10, background:"#202c33", borderRadius:8, padding:"7px 12px" },
  searchInput: { background:"transparent", border:"none", outline:"none", color:"#e9edef", fontSize:15, width:"100%" },
  chips: { display:"flex", gap:8, padding:"4px 12px 8px", flexShrink:0 },
  chip: { padding:"5px 12px", borderRadius:20, fontSize:13, fontWeight:500, cursor:"pointer", border:"none" },
  chipActive: { background:"#00a884", color:"#111b21" },
  chipInactive: { background:"#222d34", color:"#8696a0" },
  contactList: { flex:1, overflowY:"auto" },
  contactItem: { display:"flex", alignItems:"center", padding:"10px 16px", gap:12, cursor:"pointer", borderBottom:"1px solid #1a2730", transition:"background .1s" },
  contactActive: { background:"#2a3942" },
  avatar: { width:49, height:49, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, fontWeight:700, color:"#fff", flexShrink:0 },
  contactInfo: { flex:1, minWidth:0 },
  contactTop: { display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:3 },
  contactPhone: { color:"#e9edef", fontSize:16, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" },
  contactName: { fontWeight:600 },
  contactPhoneSub: { color:"#8696a0", fontSize:13 },
  contactTime: { color:"#8696a0", fontSize:12, whiteSpace:"nowrap", flexShrink:0, marginLeft:8 },
  contactBottom: { display:"flex", alignItems:"center", justifyContent:"space-between", gap:6 },
  contactPreview: { color:"#8696a0", fontSize:13, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 },
  stepBadge: { color:"#fff", borderRadius:10, padding:"2px 7px", fontSize:11, fontWeight:600, whiteSpace:"nowrap", flexShrink:0 },
  emptyMsg: { color:"#8696a0", textAlign:"center", padding:"32px 16px", fontSize:14 },
  chatPanel: { flex:1, display:"flex", flexDirection:"column", background:"#0b141a", overflow:"hidden" },
  emptyState: { flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16 },
  emptyIcon: { width:160, height:160, borderRadius:20, objectFit:"contain" },
  emptyTitle: { color:"#e9edef", fontSize:26, fontWeight:300 },
  emptySub: { color:"#8696a0", fontSize:14, textAlign:"center", lineHeight:1.7 },
  chatHeader: { display:"flex", alignItems:"center", padding:"10px 16px", background:"#202c33", minHeight:59, gap:12, flexShrink:0, flexWrap:"wrap" },
  chatHeaderInfo: { flex:1, minWidth:0 },
  chatHeaderName: { color:"#e9edef", fontSize:17, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" },
  chatHeaderStatus: { color:"#8696a0", fontSize:13, marginTop:2, display:"flex", alignItems:"center", gap:5 },
  fieldPills: { display:"flex", flexWrap:"wrap", gap:5 },
  pill: { background:"#2a3942", color:"#8696a0", borderRadius:10, padding:"3px 9px", fontSize:12, fontWeight:500 },
  messagesWrap: { flex:1, overflowY:"auto", padding:"12px 8%", display:"flex", flexDirection:"column", gap:4 },
  dateDivider: { display:"flex", justifyContent:"center", margin:"8px 0" },
  dateLabel: { background:"#182229", color:"#8696a0", fontSize:12.5, padding:"5px 12px", borderRadius:8, fontWeight:500 },
  noMsgs: { color:"#8696a0", textAlign:"center", padding:32, fontSize:14 },
  msgRow: { display:"flex", alignItems:"flex-end", gap:6 },
  bubbleOut: { maxWidth:"65%", padding:"7px 12px", borderRadius:"7.5px 2px 7.5px 7.5px", background:"#005c4b", color:"#e9edef", boxShadow:"0 1px 1px rgba(0,0,0,.25)" },
  bubbleIn:  { maxWidth:"65%", padding:"7px 12px", borderRadius:"2px 7.5px 7.5px 7.5px", background:"#202c33", color:"#e9edef", boxShadow:"0 1px 1px rgba(0,0,0,.25)" },
  senderTag: { color:"#00a884", fontSize:12.5, fontWeight:700, marginBottom:3 },
  msgText: { fontSize:14.5, lineHeight:1.55 },
  inputBar: { background:"#202c33", padding:"14px 20px", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 },
  readonlyNote: { color:"#8696a0", fontSize:13 },
};

const SP: Record<string, React.CSSProperties> = {
  overlay: { position:"fixed", inset:0, background:"rgba(0,0,0,.6)", zIndex:100, display:"flex", justifyContent:"flex-end" },
  panel: { width:480, height:"100%", background:"#202c33", display:"flex", flexDirection:"column", boxShadow:"-8px 0 32px rgba(0,0,0,.4)", overflowY:"auto" },
  header: { display:"flex", alignItems:"flex-start", justifyContent:"space-between", padding:"24px 24px 0" },
  title: { color:"#e9edef", fontSize:20, fontWeight:700 },
  sub: { color:"#8696a0", fontSize:13, marginTop:4 },
  logoutBtn: { background:"#3d1515", color:"#ff6b6b", border:"1px solid #7f2020", borderRadius:8, padding:"7px 14px", fontSize:13, fontWeight:600, cursor:"pointer" },
  closeBtn: { background:"#2a3942", color:"#8696a0", border:"none", borderRadius:8, padding:"7px 12px", fontSize:15, cursor:"pointer" },
  tabs: { display:"flex", gap:4, padding:"20px 24px 0", borderBottom:"1px solid #2a3942" },
  tab: { padding:"10px 16px", border:"none", background:"transparent", cursor:"pointer", fontSize:14, fontWeight:600, borderBottom:"2px solid transparent", marginBottom:-1 },
  tabActive: { color:"#00a884", borderBottomColor:"#00a884" },
  tabInactive: { color:"#8696a0" },
  body: { flex:1, padding:24, overflowY:"auto" },
  sectionTitle: { color:"#8696a0", fontSize:12, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:12 },
  dimText: { color:"#8696a0", fontSize:14 },
  loginList: { display:"flex", flexDirection:"column", gap:2 },
  loginRow: { display:"flex", alignItems:"flex-start", gap:12, padding:"10px 12px", background:"#2a3942", borderRadius:10, marginBottom:4 },
  loginAvatar: { width:36, height:36, borderRadius:"50%", background:"#00a884", color:"#111b21", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:15, flexShrink:0 },
  loginName: { color:"#e9edef", fontSize:14, fontWeight:600 },
  loginBrowser: { color:"#8696a0", fontWeight:400, fontSize:13 },
  loginMeta: { display:"flex", alignItems:"center", gap:10, marginTop:3, flexWrap:"wrap" },
  ipBadge: { background:"#182229", color:"#8696a0", borderRadius:6, padding:"2px 8px", fontSize:12, fontFamily:"monospace" },
  loginTime: { color:"#8696a0", fontSize:12 },
  userList: { display:"flex", flexDirection:"column", gap:4, marginBottom:4 },
  userRow: { display:"flex", alignItems:"center", gap:12, padding:"10px 12px", background:"#2a3942", borderRadius:10 },
  addForm: { display:"flex", flexDirection:"column", gap:12 },
  input: { background:"#2a3942", border:"1px solid #374045", borderRadius:8, padding:"11px 14px", color:"#e9edef", fontSize:15, outline:"none", fontFamily:"inherit" },
  errMsg: { background:"#3d1515", border:"1px solid #7f2020", borderRadius:8, padding:"10px 14px", color:"#ff6b6b", fontSize:13 },
  okMsg:  { background:"#0d2b1e", border:"1px solid #1a5c38", borderRadius:8, padding:"10px 14px", color:"#25d366", fontSize:13 },
  addBtn: { background:"#00a884", color:"#111b21", border:"none", borderRadius:8, padding:"12px", fontSize:14, fontWeight:700, cursor:"pointer" },
};
