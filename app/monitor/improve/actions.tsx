"use client";
import {useState} from "react";
type Props={proposals:any[];releases:any[];enabled:boolean;onRefresh:()=>Promise<void>};
export default function ImprovementActions({proposals,releases,enabled,onRefresh}:Props){
 const [busy,setBusy]=useState("");
 const [status,setStatus]=useState("");
 async function action(kind:string,extra:Record<string,unknown>={},confirmText?:string){
  if(confirmText&&!window.confirm(confirmText))return;
  setBusy(kind);setStatus("");
  try{const r=await fetch("/api/monitor/improve",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:kind,...extra})});const data=await r.json();if(!r.ok)throw Error(data.error||"Request failed");setStatus(data.message||"Request accepted. Check history for outcome.");await onRefresh();}
  catch(e:any){setStatus("Error: "+(e.message||"Request failed"))}finally{setBusy("")}
 }
 const btn:React.CSSProperties={padding:"10px 13px",borderRadius:9,border:"1px solid #d1d5db",background:"#fff",fontWeight:700,margin:4};
 return <section style={{padding:16,border:"1px solid #dfe3e9",borderRadius:12,background:"white"}}>
 <h3 style={{marginTop:0}}>Production improvement controls</h3>
 <p style={{fontSize:13,color:"#667085"}}These buttons use the existing evidence review, validation, publishing and rollback services. A queued action is not a successful deployment. They do not operate on sandbox conversations.</p>
 <button style={btn} disabled={!!busy||!enabled} onClick={()=>action("analyze_recent",{count:10})}>Analyze latest 10 chats</button>
 <button style={btn} disabled={!!busy||!enabled} onClick={()=>action("review_pending",{},"Review pending production conversations?")}>Review pending findings</button>
 <button style={btn} disabled={!!busy||!enabled} onClick={()=>action("publish_ready",{},"Process already approved fixes through production validation and release gates?")}>Process approved fixes</button>
 <button style={btn} disabled={!!busy||!enabled} onClick={()=>action("approve_all",{},"Queue all proposals for validation and potential production release?")}>Approve All · validated only</button>
 {status&&<p role="status" style={{color:status.startsWith("Error")?"#b42318":"#175b38"}}>{status}</p>}
 <h4>Proposals</h4>
 {!proposals.length&&<p>No proposals available.</p>}
 {proposals.slice(0,30).map((p,i)=><div key={String(p.id||i)} style={{padding:10,borderTop:"1px solid #e5e7eb"}}>
 <b>{String(p.status||"unknown")}</b> · {String(p.severity||"review")}<p style={{overflowWrap:"anywhere",fontSize:13}}>{String(p.reason||p.summary||p.finding_code||"Proposal awaiting review")}</p>
 <button style={btn} disabled={!!busy||!enabled||!p.id} onClick={()=>action("approve_proposal",{proposal:p.id},"Independently validate this proposal? Passing eligible fixes may publish under current autonomy settings.")}>Verify / Approve</button>
 <button style={btn} disabled={!!busy||!p.id} onClick={()=>action("reject_proposal",{proposal:p.id},"Dismiss this proposal?")}>Dismiss</button>
 </div>)}
 <h4>Release history and rollback</h4>
 {!releases.length&&<p>No releases recorded.</p>}
 {releases.slice(0,20).map((r,i)=><div key={String(r.id||i)} style={{padding:10,borderTop:"1px solid #e5e7eb"}}>
 <b>{String(r.status||"unknown")}</b> · {String(r.created_at||"")} {r.error&&<p style={{color:"#b42318"}}>{String(r.error)}</p>}
 <button style={btn} disabled={!!busy||!r.id} onClick={()=>action("rollback_code",{release:r.id},"Request rollback of this production release?")}>Rollback</button>
 </div>)}
 </section>;
}
