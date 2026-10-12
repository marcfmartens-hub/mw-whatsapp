"use client";

import { useEffect, useState } from "react";

export default function ResetPage() {
  const [token, setToken] = useState<string | null>(null);
  const [linkError, setLinkError] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const h = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const q = new URLSearchParams(window.location.search);
    const t = h.get("access_token");
    const err = h.get("error_description") || q.get("error_description");
    if (t) setToken(t);
    else setLinkError(err ? err.replace(/\+/g, " ") : "This reset link is invalid or has expired. Request a new one from the login screen.");
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (pw.length < 6) return setError("Password must be at least 6 characters.");
    if (pw !== pw2) return setError("The passwords don't match.");
    setLoading(true);
    const res = await fetch("/api/monitor/reset", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: token, password: pw }),
    });
    const d = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) return setError(d.error ?? "Reset failed");
    setDone(d.username ?? "");
    setTimeout(() => { window.location.href = "/monitor"; }, 1500);
  }

  return (
    <div style={S.page}>
      <div style={S.card}>
        <img src="/mw-logo.png" alt="Mister Wheelz" style={S.logo} />
        <div style={S.title}>Reset password</div>
        <div style={S.sub}>Kaya · Mister Wheelz · Monitor</div>
        {linkError && <div style={S.error}>{linkError}</div>}
        {linkError && <a href="/monitor/login" style={S.link}>Back to sign in</a>}
        {done && <div style={S.ok}>Password updated for {done} ✓ Signing you in…</div>}
        {token && !done && (
          <form onSubmit={submit} style={S.form}>
            <input style={S.input} type="text" placeholder="New password" value={pw} onChange={(e) => setPw(e.target.value)} required />
            <input style={S.input} type="text" placeholder="Repeat new password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
            {error && <div style={S.error}>{error}</div>}
            <button style={S.btn} type="submit" disabled={loading}>{loading ? "Saving…" : "Set new password"}</button>
          </form>
        )}
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#111b21", padding: 16,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" },
  card: { width: "100%", maxWidth: 360, background: "#202c33", borderRadius: 16, padding: "40px 28px 32px", display: "flex",
    flexDirection: "column", alignItems: "center", boxShadow: "0 8px 32px rgba(0,0,0,.4)", gap: 12 },
  logo: { width: 80, height: 80, borderRadius: 12, objectFit: "contain" },
  title: { color: "#e9edef", fontSize: 22, fontWeight: 700 },
  sub: { color: "#8696a0", fontSize: 13, marginBottom: 12 },
  form: { width: "100%", display: "flex", flexDirection: "column", gap: 14 },
  input: { background: "#2a3942", border: "1px solid #374045", borderRadius: 8, padding: "11px 14px", color: "#e9edef", fontSize: 15, outline: "none", fontFamily: "inherit" },
  error: { width: "100%", background: "#3d1515", border: "1px solid #7f2020", borderRadius: 8, padding: "10px 14px", color: "#ff6b6b", fontSize: 13 },
  ok: { width: "100%", background: "#0b3a2e", border: "1px solid #1f6b4f", borderRadius: 8, padding: "10px 14px", color: "#25d366", fontSize: 13 },
  btn: { background: "#00a884", color: "#111b21", border: "none", borderRadius: 8, padding: 13, fontSize: 15, fontWeight: 700, cursor: "pointer" },
  link: { color: "#00a884", fontSize: 13 },
};
