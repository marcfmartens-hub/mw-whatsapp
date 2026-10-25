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
 const [proposal,setProposal] = useState("");
 const reset = () => {setMessages([]);setChat({messages:[]});setState(null);setValue("");setError("");setNote("");setIssue("");setProposal("");};
 function analyze() {
  if(!messages.length){setError("Start a conversation first.");return;}
  const flags:string[]=[];
  for(let i=1;i<messages.length;i++){
   const before=messages[i-1],after=messages[i];
   if(before.role!=="user"||after.role!=="assistant")continue;
   if(before.content.includes("http")&&!/link|advertisement|cannot|can't|unable/i.test(after.content))flags.push("Possible unacknowledged external link.");
   if(/crazy bot|stupid bot|not listening/i.test(before.content)&&!/sorry|frustrat|understand|team|help/i.test(after.content))flags.push("Possible missed frustration.");
  }
  const report={mode:"MOCKUP ONLY - NO DEPLOYMENT",reportedIssue:issue||"Not specified",automatedFlags:flags,checks:"Heuristic preview only; AI verification not yet connected",messages,engineState:state};
  setProposal(JSON.stringify(report,null,2));
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
   setMessages(m=>[...m,{role:"assistant",content:data.reply}]);
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
 <strong>Live test conversation</strong><button onClick={reset} disabled={busy} style={{padding:"9px 14px",border:"1px solid #d7dbe2",borderRadius:8,background:"white"}}>↺ Reset chat</button></div>
 <div style={{height:"min(57vh,550px)",overflowY:"auto",padding:"16px 0",display:"flex",flexDirection:"column",gap:12}}>
 {messages.length===0&&<div style={{color:"#778294"}}>Start by typing “Hi”, sharing a car listing, or asking for an inspection.</div>}
 {messages.map((m,i)=><div key={i} style={{alignSelf:m.role==="user"?"flex-end":"flex-start",maxWidth:"88%",background:m.role==="user"?"#fff0d8":"#edf1f6",padding:"12px 15px",borderRadius:14,whiteSpace:"pre-wrap",lineHeight:1.5}}><small style={{display:"block",color:"#687386",marginBottom:4}}>{m.role==="user"?"Customer":"Kaya · real engine"}</small>{m.content}</div>)}
 {busy&&<div style={{color:"#667085"}}>Kaya is responding…</div>}<div ref={bottom}/>
 </div>
 <form onSubmit={send} style={{display:"flex",gap:8}}><input value={value} onChange={e=>setValue(e.target.value)} placeholder="Type a customer message…" maxLength={2000} style={{flex:1,minWidth:0,border:"1px solid #cbd2dc",borderRadius:10,padding:14,fontSize:16}}/><button disabled={busy||!value.trim()} style={{background:orange,border:0,borderRadius:10,padding:"0 20px",fontWeight:700}}>Send</button></form>
 {error&&<p role="alert" style={{color:"#b42318"}}>Connection error: {error}</p>}
 {note&&<p style={{color:"#9a6700"}}>{note}</p>}
 <div style={{marginTop:18,padding:16,background:"#fff7e9",borderRadius:12}}>
 <strong>Found a problem? Kaya Improve · Mockup</strong>
 <p style={{fontSize:13,color:"#667085"}}Describe the problem and generate an improvement report using the actual test transcript. This does not change production code or deploy anything.</p>
 <textarea rows={3} value={issue} onChange={e=>setIssue(e.target.value)} placeholder="What did Kaya do wrong?" style={{boxSizing:"border-box",width:"100%",border:"1px solid #d0d5dd",borderRadius:8,padding:12,fontSize:15}}/>
 <button disabled={busy||!messages.length} onClick={analyze} style={{marginTop:10,padding:"12px 16px",background:"#17202d",color:"white",border:0,borderRadius:9,fontWeight:700}}>Analyze &amp; Push for Improvement (Mock)</button>
 {proposal&&<div style={{marginTop:12,padding:12,background:"white",borderRadius:9}}><strong>Improvement report prepared · NOT DEPLOYED</strong><p style={{fontSize:13}}>Automated checks are preliminary. Copy this report for review.</p>
 <button onClick={()=>navigator.clipboard.writeText(proposal).then(()=>setNote("Report copied")).catch(()=>setError("Clipboard unavailable"))} style={{padding:10}}>Copy report</button>
 <details><summary>View report</summary><pre style={{fontSize:11,whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{proposal}</pre></details></div>}
 </div>
 </section>
 <section style={{background:"white",borderRadius:16,padding:16}}><strong>Real engine state</strong><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",fontSize:12,background:"#f4f6f8",padding:12,borderRadius:10}}>{JSON.stringify(state||{status:"No messages yet"},null,2)}</pre></section>
 </div></div></main>;
}
