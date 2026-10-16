export const REPO="marcfmartens-hub/mw-whatsapp";
export const PUBLIC_URL="https://mw-whatsapp2.vercel.app";
export class Github {
 async request<T=any>(path:string,method="GET",body?:unknown):Promise<T> {
  const token=process.env.KAYA_GITHUB_TOKEN;if(!token)throw Error("Missing KAYA_GITHUB_TOKEN runtime connection");
  if(!path.startsWith("/")||path.includes(".."))throw Error("Invalid GitHub API path");
  const r=await fetch(`https://api.github.com/repos/${REPO}${path}`,{method,headers:{Authorization:`Bearer ${token}`,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28",...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined,cache:"no-store",signal:AbortSignal.timeout(15000)});
  if(!r.ok){const e=await r.json().catch(()=>({}));throw Error(`GitHub ${r.status}: ${String(e.message??"Request failed").slice(0,250)}`);}return r.status===204?null as T:await r.json();
 }
 async main(){const ref=await this.request("/git/ref/heads/main");const commit=await this.request(`/git/commits/${ref.object.sha}`);return{sha:ref.object.sha as string,tree:commit.tree.sha as string};}
 async file(path:string,ref:string){const r=await this.request(`/contents/${path}?ref=${encodeURIComponent(ref)}`);if(r.encoding==="base64")return Buffer.from(r.content,"base64").toString("utf8");if(r.sha){const blob=await this.request(`/git/blobs/${r.sha}`);if(blob.encoding==="base64")return Buffer.from(blob.content,"base64").toString("utf8");}throw Error("Expected a UTF-8 GitHub file");}
 async productionReady(sha:string,learningHash?:string){
  // Verify the actual canonical production runtime, not a preview status.
  try{const r=await fetch(`${PUBLIC_URL}/api/kaya-improve/version`,{cache:"no-store",redirect:"error",signal:AbortSignal.timeout(10000)});if(r.ok){const v=await r.json();if(v.environment==="production"&&(v.commit===sha||(learningHash&&v.learningHash===learningHash))&&v.repository===REPO)return true;}}catch{/* Fall back to authenticated GitHub deployment evidence. */}
  const deployments=await this.request(`/deployments?sha=${sha}&per_page=30`);for(const deployment of deployments.filter((d:any)=>/^production(?:\s|$)/i.test(d.environment))){const statuses=await this.request(`/deployments/${deployment.id}/statuses?per_page=1`);if(statuses[0]?.state==="success")return true;}return false;}
 async checks(sha:string){const [checks,status]=await Promise.all([this.request(`/commits/${sha}/check-runs`),this.request(`/commits/${sha}/status`)]);const ci=checks.check_runs.filter((c:any)=>c.name==="verify");const previews=[...checks.check_runs.filter((c:any)=>/vercel/i.test(c.name)).map((c:any)=>c.conclusion),...status.statuses.filter((s:any)=>/vercel/i.test(s.context)).map((s:any)=>s.state)];return{ci:ci.length>0&&ci.every((c:any)=>c.conclusion==="success"),preview:previews.includes("success")&&!previews.some((s:string)=>["failure","error"].includes(s)),failed:ci.some((c:any)=>["failure","cancelled","timed_out"].includes(c.conclusion))||previews.some((s:string)=>["failure","error"].includes(s))};}
}
