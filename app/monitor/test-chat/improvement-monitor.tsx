"use client";
import { useState } from "react";
type Message = {role:string;content:string};
export default function ImprovementMonitor({messages}:{messages:Message[]}) {
 const [issue,setIssue]=useState("");
 const [show,setShow]=useState(false);
 const flags:string[]=[];
 for(let i=1;i<messages.length;i++){
  const a=messages[i-1],b=messages[i];
  if(a.role!=="user"||b.role!=="assistant")continue;
  if(a.content.includes("http")&&!/link|advertisement|cannot|can't|open/i.test(b.content))flags.push("Link not acknowledged, message "+(i+1));
  if(/crazy bot|not listening|stupid bot/i.test(a.content)&&!/sorry|frustrat|understand|team/i.test(b.content))flags.push("Frustration not acknowledged, message "+(i+1));
 }
 const stages=["Detect","Flag","Analyze","Solution","Test","Deploy"];
 return <section style={{marginTop:18,padding:16,border:"1px solid #d4d8e1",borderRadius:12,background:"#f7f9fc"}}>
 <h3 style={{marginTop:0}}>Autonomous Improvement Monitor · Mockup</h3>
 <p style={{fontSize:13}}>Known anomaly patterns are checked after each response. Later stages are previews, not actual AI fixes or deployment.</p>
 <div style={{display:"flex",flexWrap:"wrap",gap:7}}>{stages.map((stage,i)=><span key={stage} style={{padding:9,borderRadius:9,background:i<2&&flags.length?"#ffdb98":"#e8edf4",fontSize:12}}>{i+1}. {stage}</span>)}</div>
 <p><b>Automatic detection:</b> {flags.length?flags.length+" potential issue(s) flagged":"No known anomalies flagged"}</p>
 {flags.map((flag,i)=><p key={i} style={{color:"#955700"}}>⚑ {flag}</p>)}
 <textarea value={issue} onChange={e=>setIssue(e.target.value)} placeholder="Describe any issue the detector missed" rows={2} style={{width:"100%",boxSizing:"border-box",padding:10,border:"1px solid #cbd2dc",borderRadius:8}}/>
 <button disabled={!messages.length} onClick={()=>setShow(true)} style={{marginTop:8,padding:12,background:"#17202d",color:"white",border:0,borderRadius:8}}>Run mock analysis → solution → test</button>
 {show&&<div style={{marginTop:12,background:"white",padding:12,borderRadius:8,fontSize:13}}>
 <p><b>Analysis:</b> {issue||flags.join("; ")||"No confirmed issue. Manual review needed."}</p>
 <p><b>Candidate solution:</b> Improve contextual understanding without changing protected business policies.</p>
 <p><b>Test:</b> Simulation only — no actual regression suite was executed.</p>
 <p style={{color:"#b42318"}}><b>Execute to Vercel:</b> DISABLED in mockup. No code was changed or deployed.</p>
 </div>}
 </section>;
}
