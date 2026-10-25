"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import TestChat from "../test-chat/test-chat";
type Config={enabled:boolean;autoApprove:boolean;fullAutonomous?:boolean;schedules:Record<string,{mode:string;minutes:number}>};
type Data={state:{config:Config;revision:number;updated_by:string};runs:any[];reviews:any[];proposals:any[];autoReleases:any[];publishing?:{ready:boolean;reason:string}};
export default function IntelligenceLab(){
 const [data,setData]=useState<Data|null>(null);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [tab,setTab]=useState("Overview");
 async function load(){
  try{const r=await fetch("/api/monitor/improve",{cache:"no-store"});const j=await r.json();if(!r.ok)throw Error(j.error||"Unable to load");setData(j);setError("");}
  catch(e:any){setError(e.message||"Unable to load");}finally{setLoading(false);}
 }
 useEffect(()=>{load();},[]);
 async function toggle(){
  if(!data||busy)return;
  setBusy(true);setError("");setNotice("");
  try{
   const config={...data.state.config,enabled:!data.state.config.enabled};
   const r=await fetch("/api/monitor/improve",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"save",config,revision:data.state.revision})});
   const j=await r.json();if(!r.ok)throw Error(j.error||"Unable to save");
   await load();setNotice(config.enabled?"Improvement engine enabled. Existing approval/autonomy settings still apply.":"Improvement engine disabled. Existing WhatsApp conversations continue.");
  }catch(e:any){setError(e.message||"Unable to save");}finally{setBusy(false);}
 }
 const card:React.CSSProperties={background:"#fff",padding:20,borderRadius:16,border:"1px solid #e3e6ed"};
 const btn:React.CSSProperties={border:"1px solid #d9dee8",borderRadius:10,padding:"12px 15px",fontWeight:700,cursor:"pointer"};
 const tabs=["Overview","Test Chat","Anomaly Detection","AI Analysis","Solutions & Tests","Deployments","Learning History"];
 return <main style={{background:"#f4f6fa",minHeight:"100vh",padding:"22px 16px",color:"#17202d",fontFamily:"Arial,sans-serif"}}>
 <div style={{maxWidth:1100,margin:"auto"}}>
 <header style={{background:"#141d2b",borderRadius:18,padding:24,color:"white"}}>
 <div style={{display:"flex",justifyContent:"space-between",gap:14,flexWrap:"wrap",alignItems:"center"}}>
 <div><h1 style={{margin:"0 0 6px",fontSize:30}}><span style={{color:"#fd9800"}}>KAYA</span> Intelligence Lab</h1><p style={{margin:0,color:"#bac4d4"}}>Conversation quality · autonomous improvement monitor · Super Admin</p></div>
 <Link href="/monitor" style={{color:"white"}}>← Kaya Monitor</Link></div>
 <div style={{marginTop:22,background:"#273346",padding:16,borderRadius:14,display:"flex",gap:14,alignItems:"center",flexWrap:"wrap"}}>
 <div style={{flex:1,minWidth:170}}><strong>Improvement engine</strong><div style={{color:"#c7d0de",fontSize:13,marginTop:5}}>{data?.state.config.enabled?"ON · automatic checks allowed":"OFF · improvement jobs disabled"}</div></div>
 <button role="switch" aria-checked={!!data?.state.config.enabled} onClick={toggle} disabled={!data||busy} style={{...btn,background:data?.state.config.enabled?"#c9f7d9":"#fff",color:"#17202d",minWidth:130}}>{busy?"Saving…":data?.state.config.enabled?"● ON — switch off":"○ OFF — switch on"}</button>
 </div>
 </header>
 {error&&<p role="alert" style={{color:"#b42318",padding:12}}>{error}</p>}
 {notice&&<p style={{color:"#186a39",padding:12}}>{notice}</p>}
 <p style={{fontSize:13,color:"#667085",lineHeight:1.5}}>The toggle controls the existing Kaya Improve engine, not Kaya's customer replies. If enabled, previously configured autonomous publishing permissions still apply. The Test Chat and simulated analysis never deploy changes.</p>
 <nav style={{display:"flex",flexWrap:"wrap",gap:9,margin:"20px 0"}}>{tabs.map(t=><button key={t} onClick={()=>setTab(t)} style={{...btn,background:tab===t?"#fd9800":"white",borderColor:tab===t?"#fd9800":"#e0e4ea"}}>{t}</button>)}</nav>
 {loading?<div style={card}>Loading Intelligence Lab…</div>:tab==="Overview"?<div style={{display:"grid",gap:14}}>
 <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:12}}>
 {[[ "Conversations reviewed",data?.reviews?.length??0],["Flagged findings",data?.reviews?.reduce((n,r)=>n+(r.findings?.length||0),0)??0],["Improvement proposals",data?.proposals?.length??0],["Release records",data?.autoReleases?.length??0]].map(([label,value])=><div key={String(label)} style={card}><div style={{color:"#667085",fontSize:14}}>{label}</div><strong style={{fontSize:32}}>{value}</strong></div>)}</div>
 <div style={card}><h2>How the intelligence system works</h2><p>Conversation → Detect → Flag → Analyze → Solution → Regression Test → Approval/Deployment → Verify.</p><p>Existing review records are displayed here. The new lab workflow is a prototype; automatic AI diagnosis and safe deployment orchestration are not yet connected to the test chat.</p><button style={{...btn,background:"#fd9800"}} onClick={()=>setTab("Test Chat")}>Open real Kaya test chat →</button></div>
 <div style={card}><h3>Current settings</h3><p>Improvement: <b>{data?.state.config.enabled?"ON":"OFF"}</b> · Full autonomy: <b>{data?.state.config.fullAutonomous?"ON":"OFF"}</b> · Auto-approve: <b>{data?.state.config.autoApprove?"ON":"OFF"}</b></p><p style={{fontSize:13}}>Changing the main switch preserves the other settings. No hidden activation of autonomous publishing.</p></div>
 </div>:tab==="Test Chat"?<div style={card}><p style={{fontSize:13,color:"#667085"}}>Real production conversation planner in an isolated test session. No WhatsApp sends, CRM writes or actual bookings.</p><TestChat/></div>
 :tab==="Anomaly Detection"?<div style={card}><h2>Detected conversation anomalies</h2><p>Existing Kaya Improve findings from stored conversation reviews. Flags are not verified defects.</p>{!data?.reviews?.length?<p>No stored reviews available.</p>:data.reviews.slice(0,30).map((r,i)=><details key={i} style={{padding:12,borderBottom:"1px solid #e5e7eb"}}><summary>{r.phone||"Conversation"} · {r.findings?.length||0} flags</summary>{r.findings?.map((f:any,j:number)=><p key={j}><b>{f.code||"Finding"}:</b> {f.message}<br/><small>Evidence: {f.evidence}</small></p>)}</details>)}</div>
 :tab==="AI Analysis"?<div style={card}><h2>Analysis & verification</h2><p>Existing findings are evidence to investigate, not permission to rewrite Kaya. Automatic causal diagnosis is planned for this lab.</p><p>Use Test Chat to capture a real-engine transcript and run the mock improvement report.</p></div>
 :tab==="Solutions & Tests"?<div style={card}><h2>Proposals and validation</h2><p>{data?.proposals?.length||0} stored proposals. The isolated Test Chat currently provides a mock analysis flow; no real fix is generated or tested by that flow.</p>{data?.proposals?.slice(0,20).map((p,i)=><details key={i}><summary>{p.status} · {p.severity||"review"} · {p.reason?.slice(0,100)}</summary><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{JSON.stringify(p.validation||{},null,2)}</pre></details>)}</div>
 :tab==="Deployments"?<div style={card}><h2>Deployment and rollback</h2><p>Mockup deployment: <b>DISABLED</b>. The existing production improvement service has its own separate publishing logic; this new lab does not trigger it.</p><p>Existing release records: {data?.autoReleases?.length||0}.</p><p>Publishing connection: {data?.publishing?.ready?"Configured":"Not ready or unavailable"}.</p></div>
 :<div style={card}><h2>Learning history</h2><p>Existing improvement run history: {data?.runs?.length||0} runs.</p>{data?.runs?.slice(0,20).map((r,i)=><p key={i}>{r.kind} · {r.status} · {r.started_at?new Date(r.started_at).toLocaleString():"Unknown date"}</p>)}</div>}
 </div></main>;
}
