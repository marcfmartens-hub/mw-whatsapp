"use client";
import { useState } from "react";
type Msg = {role:"user"|"assistant";content:string};
type Memory = {messages:Msg[];[key:string]:unknown};
type Trace = {intent:string;action:string;violations:string[];engine:string};
export default function V3TestPanel() {
  const [memory,setMemory] = useState<Memory>({messages:[]});
  const [input,setInput] = useState("");
  const [trace,setTrace] = useState<Trace|null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [flagged,setFlagged] = useState<string[]>([]);
  async function send(e:React.FormEvent) {
    e.preventDefault(); if(!input.trim() || busy) return;
    const message=input.trim();setInput("");setBusy(true);setError("");
    try {
      const res=await fetch("/api/kaya-v3/test",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message,memory})});
      const data=await res.json();
      if(!res.ok) throw Error(data.error||"Request failed");
      setMemory(data.memory);setTrace({intent:data.intent,action:data.action,violations:data.violations,engine:data.engine});
    } catch(e) {setInput(message);setError(e instanceof Error?e.message:"Unknown error");}
    finally {setBusy(false);}
  }
  function reset(){setMemory({messages:[]});setTrace(null);setFlagged([]);setError("");setInput("");}
  return <main style={{background:"#0b141a",color:"#e9edef",minHeight:"100vh",padding:24,fontFamily:"Arial,sans-serif"}}>
    <div style={{maxWidth:900,margin:"auto"}}>
      <h1 style={{marginBottom:8}}>Kaya V3 — Isolated Test Lab</h1>
      <p style={{color:"#f6ad55"}}>Prototype engine — NOT the live WhatsApp bot. No CRM updates, bookings or outbound messages. This page tests the actual V3 code on the preview branch.</p>
      <div style={{display:"flex",gap:12,margin:"16px 0",flexWrap:"wrap"}}>
        <button onClick={reset} style={button}>↺ Reset conversation</button>
        <a href="/monitor/improve" style={{color:"#9bd5ff",padding:10}}>Back to Kaya Improve</a>
      </div>
      <section style={{border:"1px solid #34434b",borderRadius:12,background:"#111b21",padding:16,minHeight:300,maxHeight:520,overflowY:"auto"}}>
        {memory.messages.length===0&&<p style={{color:"#8696a0"}}>Enter a customer message below to start. Try “Hello”, “I want to sell my car”, “How much?”, “Call me”, or “I'll call you”.</p>}
        {memory.messages.map((m,i)=><div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start",margin:"10px 0"}}>
          <div style={{background:m.role==="user"?"#005c4b":"#202c33",borderRadius:10,padding:12,maxWidth:"78%",whiteSpace:"pre-wrap"}}><strong>{m.role==="user"?"Customer":"Kaya V3"}</strong><div style={{marginTop:5}}>{m.content||"(no response)"}</div></div>
        </div>)}
      </section>
      <form onSubmit={send} style={{display:"flex",gap:8,marginTop:12}}>
        <input aria-label="Customer message" value={input} onChange={e=>setInput(e.target.value)} maxLength={2000} placeholder="Type as the customer..." style={{flex:1,padding:14,background:"#202c33",border:"1px solid #34434b",borderRadius:8,color:"white",minWidth:0}}/>
        <button disabled={busy||!input.trim()} style={button}>{busy?"Testing…":"Send"}</button>
      </form>
      {error&&<p role="alert" style={{color:"#ff8888"}}>{error}</p>}
      <section style={{marginTop:18,background:"#202c33",borderRadius:10,padding:16}}>
        <h3>Engine analysis</h3>
        {trace?<><p><b>Intent:</b> {trace.intent} · <b>Action:</b> {trace.action}</p><p><b>Rule violations:</b> {trace.violations.length?trace.violations.join(", "):"None detected by prototype checks"}</p><p><b>Engine:</b> {trace.engine}</p></>:<p>No messages yet.</p>}
        <button style={button} onClick={()=>setFlagged(v=>[...v,"Turn "+(memory.messages.length/2)+": "+(memory.messages.at(-1)?.content||"")])} disabled={!trace}>⚑ Flag latest reply</button>
        <p style={{fontSize:13,color:"#8696a0"}}>Flags are local to this browser session; they are not yet sent to Kaya Improve.</p>
        {flagged.map((f,i)=><p key={i} style={{color:"#f6ad55"}}>{f}</p>)}
      </section>
    </div>
  </main>;
}
const button:React.CSSProperties={background:"#fd9800",border:0,borderRadius:8,padding:"11px 16px",fontWeight:700,cursor:"pointer",color:"#111"};
