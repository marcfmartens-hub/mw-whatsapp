"use client";
import {useState} from "react";
type Finding={turn:number;input:string;reply:string;intent:string;violations:string[];reason:string;error?:string};
type Report={id:string;turns:number;errors:number;violations:number;findings:Finding[]};
export default function ReplayPanel(){
 const [running,setRunning]=useState(false),[status,setStatus]=useState("Not started"),[reports,setReports]=useState<Report[]>([]),[error,setError]=useState("");
 async function run(){
  if(running)return;setRunning(true);setError("");setReports([]);
  const all:Report[]=[];
  try{
   const index=await fetch("/api/kaya-v3/replay",{cache:"no-store"});const list=await index.json();
   if(!index.ok)throw Error(list.error||"Cannot load conversations");
   for(let i=0;i<list.ids.length;i++){
    const id=list.ids[i];let offset=0,memory:any={messages:[]};let errors=0,violations=0;const findings:Finding[]=[];let done=false,turns=0;
    while(!done){
     const res=await fetch("/api/kaya-v3/replay",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,offset,memory})});
     const data=await res.json();if(!res.ok)throw Error(data.error||"Replay request failed");
     memory=data.memory;offset=data.nextOffset;done=data.done;turns=data.totalCustomerTurns;errors+=data.errors;violations+=data.violations;
     findings.push(...data.results.filter((x:Finding)=>x.violations.length>0||x.error));
     setStatus("Conversation "+(i+1)+"/"+list.ids.length+" · "+offset+"/"+turns+" turns");
    }
    all.push({id,turns,errors,violations,findings});setReports([...all]);
   }
   setStatus("Finished: "+all.length+" conversations. No WhatsApp, CRM or booking changes.");
  }catch(e){setError(e instanceof Error?e.message:"Replay failed");setStatus("Stopped after "+all.length+" complete conversations");}
  finally{setRunning(false);}
 }
 const totals=reports.reduce((a,r)=>({turns:a.turns+r.turns,errors:a.errors+r.errors,violations:a.violations+r.violations}),{turns:0,errors:0,violations:0});
 function exportReport(){const blob=new Blob([JSON.stringify({generatedAt:new Date().toISOString(),reports,totals},null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="kaya-v3-historical-replay.json";a.click();URL.revokeObjectURL(a.href);}
 return <main style={{maxWidth:1100,margin:"auto",padding:24,fontFamily:"Arial",color:"#e9edef",background:"#111b21",minHeight:"100vh"}}>
 <h1>Kaya V3 — Historical AI Replay</h1><p>Super Admin only. Read-only replay of up to 200 historical chats. Each customer turn runs through the real V3 AI engine with carried-forward memory. This may take considerable time and incur model usage costs. Do not close this page while running.</p>
 <button disabled={running} onClick={run} style={{background:"#fd9800",padding:14,border:0,borderRadius:8,fontWeight:700}}>{running?"Running…":"Run historical AI stress test"}</button>{" "}
 <button disabled={!reports.length} onClick={exportReport} style={{padding:14}}>Export JSON report</button>
 <p>{status}</p>{error&&<p style={{color:"#ff8b8b"}}>{error}</p>}
 <h2>Results</h2><p>Completed conversations: {reports.length} · Customer turns: {totals.turns} · Flagged violations: {totals.violations} · Engine errors: {totals.errors}</p>
 <p style={{color:"#ffbd69"}}>Automated flags are heuristic indicators, not independent proof of compliance. Review generated replies manually before production approval.</p>
 {reports.filter(r=>r.errors||r.violations).slice(-25).map((r,i)=><details key={r.id}><summary>Conversation {r.id.slice(0,8)} · {r.turns} turns · {r.violations} flags · {r.errors} errors</summary>{r.findings.map((f,j)=><div key={j} style={{padding:10,borderBottom:"1px solid #455"}}><b>Turn {f.turn}: {f.violations.join(", ")}</b><p>Customer: {f.input}</p><p>V3: {f.reply}</p><p>{f.reason}</p></div>)}</details>)}
 </main>;
}
