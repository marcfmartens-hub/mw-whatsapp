"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [fEmail, setFEmail] = useState("");
  const [fMsg, setFMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fBusy, setFBusy] = useState(false);

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setFMsg(null); setFBusy(true);
    const res = await fetch("/api/monitor/forgot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: fEmail }) });
    const d = await res.json().catch(() => ({}));
    setFBusy(false);
    if (d.contactAdmin) setFMsg({ ok: false, text: "Password reset by email is only for the super admin. Please ask your super admin to reset your password." });
    else if (!res.ok) setFMsg({ ok: false, text: d.error ?? "Something went wrong" });
    else setFMsg({ ok: true, text: "A reset link has been sent to your email. Open it on this device." });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/monitor/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        router.push("/monitor");
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error ?? "Login failed");
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={S.page}>
      <div style={S.card}>
        <img src="/mw-logo.png" alt="Mister Wheelz" style={S.logo} />
        <div style={S.title}>WhatsApp AI Bot</div>
        <div style={S.sub}>Kaya · Mister Wheelz · Monitor</div>

        <form onSubmit={handleSubmit} style={S.form}>
          <div style={S.field}>
            <label style={S.label}>Username</label>
            <input
              style={S.input}
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              required
            />
          </div>
          <div style={S.field}>
            <label style={S.label}>Password</label>
            <input
              style={S.input}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              required
            />
          </div>
          {error && <div style={S.error}>{error}</div>}
          <button style={{ ...S.btn, ...(loading ? S.btnDisabled : {}) }} type="submit" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {!forgot && (
          <div style={S.forgot} onClick={() => { setForgot(true); setFMsg(null); }}>Forgot password?</div>
        )}
        {forgot && (
          <form onSubmit={handleForgot} style={{ ...S.form, marginTop: 20 }}>
            <input style={S.input} type="email" placeholder="Your email" value={fEmail} onChange={(e) => setFEmail(e.target.value)} required />
            {fMsg && <div style={fMsg.ok ? S.ok : S.error}>{fMsg.text}</div>}
            <button style={S.btn} type="submit" disabled={fBusy}>{fBusy ? "Sending…" : "Send reset link"}</button>
            <div style={S.forgot} onClick={() => setForgot(false)}>Cancel</div>
          </form>
        )}
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#111b21",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
  },
  card: {
    width: "100%", maxWidth: 360,
    background: "#202c33",
    borderRadius: 16,
    padding: "40px 36px 36px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    boxShadow: "0 8px 32px rgba(0,0,0,.4)",
  },
  logo: {
    width: 80, height: 80, borderRadius: 12,
    objectFit: "contain", marginBottom: 16,
  },
  title: { color: "#e9edef", fontSize: 22, fontWeight: 700, marginBottom: 4 },
  sub: { color: "#8696a0", fontSize: 13, marginBottom: 32 },
  form: { width: "100%", display: "flex", flexDirection: "column", gap: 16 },
  field: { display: "flex", flexDirection: "column", gap: 6 },
  label: { color: "#8696a0", fontSize: 13, fontWeight: 500 },
  input: {
    background: "#2a3942", border: "1px solid #374045", borderRadius: 8,
    padding: "11px 14px", color: "#e9edef", fontSize: 15, outline: "none",
    fontFamily: "inherit",
  },
  error: {
    background: "#3d1515", border: "1px solid #7f2020", borderRadius: 8,
    padding: "10px 14px", color: "#ff6b6b", fontSize: 13,
  },
  btn: {
    marginTop: 4, background: "#00a884", color: "#111b21", border: "none",
    borderRadius: 8, padding: "13px", fontSize: 15, fontWeight: 700,
    cursor: "pointer", transition: "background .15s",
  },
  forgot: { color: "#00a884", fontSize: 13, cursor: "pointer", marginTop: 16, textAlign: "center" },
  ok: { background: "#0b3a2e", border: "1px solid #1f6b4f", borderRadius: 8, padding: "10px 14px", color: "#25d366", fontSize: 13 },
  btnDisabled: { background: "#005c47", cursor: "not-allowed", color: "#4a7a6a" },
};
