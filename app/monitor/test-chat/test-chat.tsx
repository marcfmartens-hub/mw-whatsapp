"use client";
import { useState, useRef, useEffect } from "react";

type Msg = { role: "user" | "assistant"; content: string };
export default function TestChat() {
 const [messages,setMessages] = useState<Msg[]>([]);
 const [chat,setChat] = useState<any>({messages:[]});
 const [value,setValue] = useState("");
 const [busy,setBusy] = useState(false);
 const [error,setError] = useState("");
 const [state,setState] = useState<any>(null);
 const [note,setNote] = useState("");
 const [issue,setIssue] = useState("");
 const [report,setReport] = useState("");
 const bottom = useRef<HTMLDivElement>(null);
 useEffect(()=>bottom.current?.scrollIntoView({behavior:"smooth"}),[messages]);
 async function send(e: React.FormEvent) {
  e.preventDefault(); const message=value.trim(); if(!message||busy)return;
  setValue("");setError("");setBusy(true);
  setMessages(m=>[...m,{role:"user",content:message}]);
  try {
   const res=await fetch("/api/test-chat",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({message,chat})});
   const data=await res.json();if(!res.ok||data.source!=="production-conversation-engine")throw Error(data.error||"Unexpected test response");
   setChat(data.chat);setState(data.state);setNote(data.note||"");
   setMessages(m=>[...m,{role:"assistant",content:String(data.reply)}]);
  } catch(e:any){setError(e.message||"Connection failed");}
  finally {setBusy(false);}
 }
 const orange="#fd9800";
 return <main style={{minHeight:"100vh",background:"#f3f5f8",padding:"20px",fontFamily:"Arial,sans-serif",color:"#17202d"}}>
 <div style={{maxWidth:1040,margin:"auto"}}>
 <header style={{background:"#151c29",color:"white",padding:24,borderRadius:16}}>
 <div style={{fontSize:24,fontWeight:800}}><span style={{color:orange}}>KAYA</span> · Real Conversation Test</div>
 <p style={{marginBottom:0,color:"#c7d0df"}}>Connected to the production conversation engine · isolated sandbox · no WhatsApp messages or CRM writes</p>
 </header>
 <div style={{background:"#fff3d6",padding:14,borderRadius:12,margin:"15px 0",fontSize:14}}>This runs Kaya's actual conversation-state planner and vehicle extraction code. It does not replay the entire WhatsApp webhook, send messages, create leads or reserve real slots. No responses are simulated.</div>
 <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr)",gap:16}}>
 <section style={{background:"white",borderRadius:16,padding:16}}>
 <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
 <strong>Live test conversation</strong><button onClick={()=>{setMessages([]);setChat({messages:[]});setState(null);setError("");setNote("");setValue("");setIssue("");setReport("");}} style={{padding:"9px 14px",border:"1px solid #d7dbe2",borderRadius:8,background:"white"}}>↺ Reset chat</button></div>
 <div style={{height:"min(57vh,550px)",overflowY:"auto",padding:"16px 0",display:"flex",flexDirection:"column",gap:12}}>
 {messages.length===0&&<div style={{color:"#778294"}}>Start by typing “Hi”, sharing a car listing, or asking for an inspection.</div>}
 {messages.map((m,i)=><div key={i} style={{alignSelf:m.role==="user"?"flex-end":"flex-start",maxWidth:"88%",background:m.role==="user"?"#fff0d8":"#edf1f6",padding:"12px 15px",borderRadius:14,whiteSpace:"pre-wrap",lineHeight:1.5}}><small style={{display:"block",color:"#687386",marginBottom:4}}>{m.role==="user"?"Customer":"Kaya · real engine"}</small>{m.content}</div>)}
 {busy&&<div style={{color:"#667085"}}>Kaya is responding…</div>}<div ref={bottom}/>
 </div>
 <form onSubmit={send} style={{display:"flex",gap:8}}><input value={value} onChange={e=>setValue(e.target.value)} placeholder="Type a customer message…" maxLength={2000} style={{flex:1,minWidth:0,border:"1px solid #cbd2dc",borderRadius:10,padding:14,fontSize:16}}/><button disabled={busy||!value.trim()} style={{background:orange,border:0,borderRadius:10,padding:"0 20px",fontWeight:700}}>Send</button></form>
 {error&&<p role="alert" style={{color:"#b42318"}}>Connection error: {error}</p>}
 {note&&<p style={{color:"#9a6700"}}>{note}</p>}
 <div style={{padding:14,marginTop:14,background:"#fff7e9",borderRadius:12}}>
 <strong>Kaya Improve · Test proposal (mockup)</strong>
 <p style={{fontSize:13}}>Report a problem in this conversation. This creates a local report only; it cannot change or deploy production code.</p>
 <textarea value={issue} onChange={e=>setIssue(e.target.value)} placeholder="Describe what Kaya did wrong" rows={3} style={{width:"100%",boxSizing:"border-box",padding:10}}/>
 <button disabled={!messages.length||busy} onClick={()=>setReport(JSON.stringify({mode:"mockup only",issue,transcript:messages,state},null,2))} style={{marginTop:10,padding:12,background:"#17202d",color:"white",border:0,borderRadius:8}}>Analyze &amp; Push Improvement (Mock)</button>
 {report&&<div><p>Proposal prepared locally. No AI analysis or Vercel deployment performed.</p><button onClick={()=>navigator.clipboard.writeText(report)}>Copy report</button><details><summary>View report</summary><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",fontSize:11}}>{report}</pre></details></div>}
 </div>
 </section>
 <section style={{background:"white",borderRadius:16,padding:16}}><strong>Real engine state</strong><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",fontSize:12,background:"#f4f6f8",padding:12,borderRadius:10}}>{JSON.stringify(state||{status:"No messages yet"},null,2)}</pre></section>
 </div></div></main>;
}
