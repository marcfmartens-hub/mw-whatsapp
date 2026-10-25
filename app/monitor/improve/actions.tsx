"use client";
import { useState } from "react";
export default function ImprovementActions(props:{proposals:any[];releases:any[];enabled:boolean;onRefresh:()=>Promise<void>}) {
 const [busy,setBusy]=useState(false);
 const [status,setStatus]=useState("");
 async function run(action:string,extra:Record<string,unknown>={}) {
  if(busy)return;
  if(!window.confirm("Run "+action+" on production? Existing validation and approval policies apply."))return;
  setBusy(true);
  try {
   const response=await fetch("/api/monitor/improve",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,...extra})});
   const result=await response.json();
   if(!response.ok)throw new Error(result.error||"Request failed");
   setStatus(result.message||"Request queued; check history.");
   await props.onRefresh();
  } catch(error) {
   setStatus(error instanceof Error?error.message:"Request failed");
  } finally {
   setBusy(false);
  }
 }
 return (
  <section style={{padding:16,background:"white",borderRadius:12,marginTop:20}}>
   <h3>Production Improvement Controls</h3>
   <p>These use existing production validation, proposal approval and rollback services. A queued action is not a completed release.</p>
   <button disabled={busy||!props.enabled} onClick={()=>run("analyze_recent",{count:10})}>Analyze latest 10 chats</button>{" "}
   <button disabled={busy||!props.enabled} onClick={()=>run("review_pending")}>Review pending</button>{" "}
   <button disabled={busy||!props.enabled} onClick={()=>run("publish_ready")}>Process approved fixes</button>{" "}
   <button disabled={busy||!props.enabled} onClick={()=>run("approve_all")}>Approve all with validation</button>
   {status&&<p role="status">{status}</p>}
   <h4>Proposals</h4>
   {props.proposals.slice(0,30).map((proposal:any,index:number)=>(
    <div key={String(proposal.id||index)} style={{padding:10,borderTop:"1px solid #ddd"}}>
     <strong>{String(proposal.status||"unknown")}</strong>
     <p>{String(proposal.reason||proposal.summary||"Improvement proposal")}</p>
     <button disabled={busy||!props.enabled||!proposal.id} onClick={()=>run("approve_proposal",{proposal:proposal.id})}>Verify / Approve</button>{" "}
     <button disabled={busy||!proposal.id} onClick={()=>run("reject_proposal",{proposal:proposal.id})}>Dismiss</button>
    </div>
   ))}
   <h4>Release History</h4>
   {props.releases.slice(0,20).map((release:any,index:number)=>(
    <div key={String(release.id||index)} style={{padding:10,borderTop:"1px solid #ddd"}}>
     {String(release.status||"unknown")} · {String(release.created_at||"")}
     <button disabled={busy||!release.id} onClick={()=>run("rollback_code",{release:release.id})}>Rollback</button>
    </div>
   ))}
  </section>
 );
}
