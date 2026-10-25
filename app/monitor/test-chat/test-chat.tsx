"use client";
import {useEffect,useRef,useState} from "react";
type Msg={role:"user"|"assistant";content:string};
type Finding={id:string;code:string;severity:string;message:string;evidence:string;suggestion:string;status:string};
type Intelligence={findings:Finding[];regression:{passed:number;total:number;results:any[]};stages:{name:string;status:string}[]};
export default function TestChat(){
 const [messages,setMessages]=useState<Msg[]>([]);
 const [chat,setChat]=useState<any>({messages:[]});
 const [value,setValue]=useState("");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [state,setState]=useState<any>(null);
 const [intel,setIntel]=useState<Intelligence|null>(null);
 const [issue,setIssue]=useState("");
 const [review,setReview]=useState<any>(null);
 const [tab,setTab]=useState<"chat"|"analysis"|"tests">("chat");
 const bottom=useRef<HTMLDivElement>(null);
 useEffect(()=>{bottom.current?.scrollIntoView({behavior:"smooth",block:"nearest"});},[messages]);
 function reset(){setMessages([]);setChat({messages:[]});setValue("");setBusy(false);setError("");setState(null);setIntel(null);setIssue("");setReview(null);setTab("chat");}
 async function send(e:React.FormEvent){e.preventDefault();const message=value.trim();if(!message||busy)return;setBusy(true);setValue("");setError("");
  try{
   const res=await fetch("/api/test-chat",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({message,chat})});
   const data=await res.json();if(!res.ok||data.source!=="production-conversation-engine")throw Error(data.error||"Unexpected test response");
   setChat(data.chat);setState(data.state);setIntel(data.intelligence||null);setMessages(data.chat.messages||[]);setReview(null);
  }catch(e:any){setError(e.message||"Connection failed");setValue(message);}
  finally{setBusy(false);}
 }
 function reviewIssue(){
  if(!messages.length)return;
  const findings=intel?.findings||[];
  setReview({reportedIssue:issue||"Review all flagged anomalies",evidence:messages.map((m,i)=>({turn:i+1,role:m.role,text:m.content})),detectorFindings:findings,proposedSolutions:findings.map(f=>({code:f.code,suggestion:f.suggestion})),regression:intel?.regression||null,verification:"Not independently verified",deployment:"BLOCKED: sandbox test; production publishing requires validated proposal and separate approval policy"});
  setTab("analysis");
 }
 const button:React.CSSProperties={padding:"10px 14px",borderRadius:9,border:"1px solid #d0d5dd",background:"white",cursor:"pointer",fontWeight:700};
 const card:React.CSSProperties={border:"1px solid #e1e5ed",background:"#fff",borderRadius:12,padding:16};
 return <section style={{fontFamily:"Arial,sans-serif",color:"#17202d",maxWidth:920,margin:"0 auto"}}>
  <div style={{...card,background:"#fff7e9",marginBottom:14,fontSize:13}}>LIVE ENGINE + REAL RULE-BASED DETECTOR. Regression tests execute on the server after each response. AI root-cause validation, candidate patch generation, and production deployment are not performed by this isolated test. Real customer conversations and CRM are untouched.</div>
  <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
   <button style={{...button,background:tab==="chat"?"#fd9800":"white"}} onClick={()=>setTab("chat")}>Conversation</button>
   <button style={{...button,background:tab==="analysis"?"#fd9800":"white"}} onClick={()=>setTab("analysis")}>Anomalies ({intel?.findings.length||0})</button>
   <button style={{...button,background:tab==="tests"?"#fd9800":"white"}} onClick={()=>setTab("tests")}>Tests &amp; rollout</button>
   <button style={{...button,marginLeft:"auto"}} disabled={busy} onClick={reset}>↺ Reset all fields</button>
  </div>
  <div style={{display:"flex",gap:7,flexWrap:"wrap",marginBottom:14}}>{(intel?.stages||["Detect","Flag","Analyze","Solution","Test","Deploy"].map(name=>({name,status:"waiting"}))).map((stage,i)=><div key={i} style={{padding:"8px 10px",background:stage.status==="complete"||stage.status==="clear"?"#d8f6e3":stage.status==="flagged"?"#ffe0b2":"#edf0f4",borderRadius:8,fontSize:12}}><b>{i+1}. {stage.name}</b><div>{stage.status}</div></div>)}</div>
  {tab==="chat"&&<div style={card}>
   <div style={{height:"min(55vh,500px)",minHeight:250,overflowY:"auto",display:"flex",flexDirection:"column",gap:10,padding:8,background:"#f7f9fc",borderRadius:10}}>
    {!messages.length&&<p style={{color:"#667085"}}>Type “Hi” to start a fresh real-engine test.</p>}
    {messages.map((m,i)=><div key={i} style={{alignSelf:m.role==="user"?"flex-end":"flex-start",maxWidth:"88%",padding:13,background:m.role==="user"?"#fff0d6":"white",borderRadius:12,whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}><small style={{display:"block",color:"#667085"}}>{m.role==="user"?"Customer":"Kaya"}</small>{String(m.content)}</div>)}<div ref={bottom}/>
   </div>
   <form onSubmit={send} style={{display:"flex",gap:8,marginTop:12}}><input aria-label="Customer message" value={value} onChange={e=>setValue(e.target.value)} placeholder="Type a customer message…" maxLength={2000} style={{flex:1,minWidth:0,padding:13,border:"1px solid #d0d5dd",borderRadius:10,fontSize:16}}/><button disabled={busy||!value.trim()} style={{...button,background:"#fd9800"}}>{busy?"Sending…":"Send"}</button></form>
   {error&&<p role="alert" style={{color:"#b42318"}}>{error}</p>}
   <div style={{marginTop:15}}><strong>Flag a problem immediately</strong><textarea value={issue} onChange={e=>setIssue(e.target.value)} placeholder="Describe exactly what Kaya did wrong…" rows={2} style={{display:"block",boxSizing:"border-box",width:"100%",padding:12,margin:"8px 0",border:"1px solid #d0d5dd",borderRadius:9}}/><button style={{...button,background:"#17202d",color:"white"}} disabled={!messages.length} onClick={reviewIssue}>Analyze &amp; prepare improvement proposal</button></div>
  </div>}
  {tab==="analysis"&&<div style={card}><h3>Conversation quality analysis</h3>
   <p style={{fontSize:13}}>Real detector findings. Each finding is a suspicion, not proof of a defect.</p>
   {!intel?.findings.length&&<p>No rule-based anomalies detected in the current conversation.</p>}
   {intel?.findings.map((f,i)=><div key={i} style={{borderLeft:"4px solid #fd9800",padding:12,background:"#fff8eb",margin:"10px 0"}}><strong>{f.code} · {f.severity}</strong><p>{f.message}</p><p><b>Evidence:</b> {f.evidence}</p><p><b>Suggested solution:</b> {f.suggestion}</p><small>Awaiting independent verification · no code changes</small></div>)}
   {review&&<div style={{background:"#f4f6fa",padding:12,borderRadius:10}}><strong>Manual review packet ready</strong><p>{review.reportedIssue}</p><p>Transcript, detector evidence and regression results captured for further verification.</p><button style={button} onClick={()=>navigator.clipboard.writeText(JSON.stringify(review,null,2)).catch(()=>setError("Clipboard unavailable"))}>Copy evidence packet</button><details><summary>Full review packet</summary><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",fontSize:11}}>{JSON.stringify(review,null,2)}</pre></details></div>}
  </div>}
  {tab==="tests"&&<div style={card}><h3>Regression and rollout</h3><p><b>Baseline regression:</b> {intel?intel.regression.passed+" / "+intel.regression.total+" passed":"Waiting for a test message"}</p>
   {intel?.regression.results?.map((t:any,i:number)=><div key={i} style={{padding:8,borderBottom:"1px solid #e5e7eb"}}>{t.passed?"✓":"✗"} {String(t.name||t.id||"Regression case "+(i+1))}</div>)}
   <p><b>Candidate fix replay:</b> Not run — no validated patch exists.</p><p><b>GitHub / Vercel rollout:</b> BLOCKED for sandbox sessions.</p><p><b>Rollback:</b> Existing production release controls remain separate from this test.</p>
   <details><summary>Conversation state</summary><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",fontSize:11}}>{JSON.stringify(state,null,2)}</pre></details>
  </div>}
 </section>;
}
