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
 const [flags,setFlags] = useState<string[]>([]);
 const [pipeline,setPipeline] = useState<"idle"|"detected"|"analyzed"|"proposed"|"tested"|"deployed">("idle");
 const [evidence,setEvidence] = useState("");
 const [solution,setSolution] = useState("");
 const [testResult,setTestResult] = useState("");
 function detect(ms:Msg[]) {
  const found:string[]=[];
  for(let i=1;i<ms.length;i++){
   const a=ms[i-1],b=ms[i];
   if(a.role!=="user"||b.role!=="assistant")continue;
   if(/https?:\/\//i.test(a.content)&&!/link|advertisement|cannot|can't|unable|open/i.test(b.content))found.push("External link not acknowledged · turns "+i+"–"+(i+1));
   if(/crazy bot|stupid bot|not listening|useless bot/i.test(a.content)&&!/sorry|frustrat|understand|team|help/i.test(b.content))found.push("Customer frustration not acknowledged · turns "+i+"–"+(i+1));
   if(/\b(?:mileage|\d{2,3},?000\s*km)\b/i.test(a.content)&&/what(?:'s| is) the mileage/i.test(b.content))found.push("Potential repeated mileage question · turns "+i+"–"+(i+1));
  }
  setFlags(found);setPipeline(found.length?"detected":"idle");
  if(found.length){setEvidence(found.join("\n"));setSolution("Suggested strategy: acknowledge the customer\'s last message, preserve previously provided information, and avoid repeating answered questions.");setTestResult("");}
 }
 function runMockPipeline() {
  if(!messages.length)return;
  const problem=issue.trim()||flags[0]||"User-submitted conversation for review";
  setEvidence(problem+"\nEvidence: "+messages.length+" transcript messages captured.");
  setSolution("Candidate: improve contextual interpretation while retaining protected Mister Wheelz business rules.");
  setTestResult("SIMULATED: replay and regression checks shown for workflow demonstration only. No automated test suite was executed.");
  setPipeline("tested");
  setReport(JSON.stringify({mode:"MOCK",problem,transcript:messages,state,solution:"Contextual response strategy",tests:"SIMULATED",deployment:"NOT EXECUTED"},null,2));
 }

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
   setMessages(m=>{const next=[...m,{role:"assistant" as const,content:data.reply}];detect(next);return next;});
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
 <strong>Live test conversation</strong><button onClick={()=>{setMessages([]);setChat({messages:[]});setState(null);setError("");setNote("");setValue("");setIssue("");setReport("");setFlags([]);setPipeline("idle");setEvidence("");setSolution("");setTestResult("");}} style={{padding:"9px 14px",border:"1px solid #d7dbe2",borderRadius:8,background:"white"}}>↺ Reset chat</button></div>
 <div style={{height:"min(57vh,550px)",overflowY:"auto",padding:"16px 0",display:"flex",flexDirection:"column",gap:12}}>
 {messages.length===0&&<div style={{color:"#778294"}}>Start by typing “Hi”, sharing a car listing, or asking for an inspection.</div>}
 {messages.map((m,i)=><div key={i} style={{alignSelf:m.role==="user"?"flex-end":"flex-start",maxWidth:"88%",background:m.role==="user"?"#fff0d8":"#edf1f6",padding:"12px 15px",borderRadius:14,whiteSpace:"pre-wrap",lineHeight:1.5}}><small style={{display:"block",color:"#687386",marginBottom:4}}>{m.role==="user"?"Customer":"Kaya · real engine"}</small>{m.content}</div>)}
 {busy&&<div style={{color:"#667085"}}>Kaya is responding…</div>}<div ref={bottom}/>
 </div>
 <form onSubmit={send} style={{display:"flex",gap:8}}><input value={value} onChange={e=>setValue(e.target.value)} placeholder="Type a customer message…" maxLength={2000} style={{flex:1,minWidth:0,border:"1px solid #cbd2dc",borderRadius:10,padding:14,fontSize:16}}/><button disabled={busy||!value.trim()} style={{background:orange,border:0,borderRadius:10,padding:"0 20px",fontWeight:700}}>Send</button></form>
 {error&&<p role="alert" style={{color:"#b42318"}}>Connection error: {error}</p>}
 {note&&<p style={{color:"#9a6700"}}>{note}</p>}
 <div style={{padding:16,marginTop:16,border:"1px solid #d0d5dd",borderRadius:12,background:"#f8fafc"}}>
 <strong>Autonomous Improvement Monitor · MOCKUP</strong>
 <p style={{fontSize:13,color:"#667085"}}Automatic anomaly checks run after every Kaya response. The stages below demonstrate the future improvement process; they do not deploy fixes.</p>
 <div style={{display:"flex",gap:7,flexWrap:"wrap",marginBottom:12}}>{["Detect","Flag","Analyze","Solution","Test","Deploy"].map((name,i)=><span key={name} style={{padding:"8px 10px",borderRadius:9,fontSize:12,background:(pipeline==="idle"?"#edf1f6":i<=(pipeline==="detected"?1:4)?"#fff0d8":"#edf1f6"),border:"1px solid #d0d5dd"}}>{i+1}. {name}</span>)}</div>
 <div style={{fontSize:14,marginBottom:10}}><b>Detection status:</b> {flags.length?flags.length+" potential anomaly flag(s)":"No known anomaly detected"}</div>
 {flags.map((f,i)=><p key={i} style={{color:"#a15c00",margin:"6px 0"}}>⚑ {f}</p>)}
 {evidence&&<p style={{fontSize:13,whiteSpace:"pre-wrap"}}><b>Evidence / analysis:</b> {evidence}</p>}
 {solution&&<p style={{fontSize:13}}><b>Proposed solution:</b> {solution}</p>}
 {testResult&&<p style={{fontSize:13}}><b>Test:</b> {testResult}</p>}
 <p style={{fontSize:13,color:"#b42318"}}<b>Deployment:</b> BLOCKED — mockup only. No code changes, no GitHub push, no Vercel deployment.</p>
 </div>
 <div style={{padding:14,marginTop:14,background:"#fff7e9",borderRadius:12}}>
 <strong>Kaya Improve · Test proposal (mockup)</strong>
 <p style={{fontSize:13}}>Report a problem in this conversation. This creates a local report only; it cannot change or deploy production code.</p>
 <textarea value={issue} onChange={e=>setIssue(e.target.value)} placeholder="Describe what Kaya did wrong" rows={3} style={{width:"100%",boxSizing:"border-box",padding:10}}/>
 <button disabled={!messages.length||busy} onClick={runMockPipeline} style={{marginTop:10,padding:12,background:"#17202d",color:"white",border:0,borderRadius:8}}>Analyze &amp; Push Improvement (Mock)</button>
 {report&&<div><p>Proposal prepared locally. No AI analysis or Vercel deployment performed.</p><button onClick={()=>navigator.clipboard.writeText(report)}>Copy report</button><details><summary>View report</summary><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",fontSize:11}}>{report}</pre></details></div>}
 </div>
 </section>
 <section style={{background:"white",borderRadius:16,padding:16}}><strong>Real engine state</strong><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",fontSize:12,background:"#f4f6f8",padding:12,borderRadius:10}}>{JSON.stringify(state||{status:"No messages yet"},null,2)}</pre></section>
 </div></div></main>;
}
