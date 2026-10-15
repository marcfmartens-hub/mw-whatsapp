import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const git=(...a)=>execFileSync('git',a,{encoding:'utf8',stdio:['ignore','pipe','ignore'],maxBuffer:20*1024*1024});
const file='lib/kaya-improve/history.json';
const history=JSON.parse(fs.readFileSync(file,'utf8'));
const command=process.argv[2]??'create';
if(command==='restore'){
 const release=history.releases.find(r=>r.id===process.argv[3]);if(!release)throw Error('Release not found');
 if(git('status','--porcelain').trim())throw Error('Use a clean checkout for rollback');
 for(const f of release.files){if(f.before===null)fs.rmSync(f.path,{force:true});else{fs.mkdirSync(f.path.split('/').slice(0,-1).join('/')||'.',{recursive:true});fs.writeFileSync(f.path,f.before);}}
 console.log('Previous files restored locally. Review the diff, test, then commit and deploy. No customer or CRM records were changed.');
}else if(command==='check'){
 const r=history.releases[0];if(!r)throw Error('No backup');
 const paths=git('diff','--name-only',r.base_commit,'HEAD').trim().split('\n').filter(p=>p&&p!==file);
 for(const p of paths){const entry=r.files.find(f=>f.path===p);if(!entry)throw Error(`Missing backup: ${p}`);const current=fs.existsSync(p)?fs.readFileSync(p,'utf8'):null;if(current!==entry.after)throw Error(`Backup is stale: ${p}`);}
 console.log(`Backup verified: ${r.files.length} changed files`);
}else{
 const base=process.argv[3]??git('rev-parse','HEAD').trim();
 const changed=git('diff','--name-only',base).trim().split('\n');
 const added=git('ls-files','--others','--exclude-standard').trim().split('\n');
 const paths=[...new Set([...changed,...added])].filter(p=>p&&p!==file).sort();
 const files=paths.map(path=>{if(path.startsWith('.git/')||path.startsWith('.vercel/')||path.includes('..')||/secret|\.env/i.test(path))throw Error(`Excluded private path: ${path}`);let before=null;try{before=git('show',`${base}:${path}`);}catch{}const after=fs.existsSync(path)?fs.readFileSync(path,'utf8'):null;return{path,status:before===null?'added':after===null?'deleted':'modified',before,after};});
 const release={id:new Date().toISOString().replace(/[:.]/g,'-'),created_at:new Date().toISOString(),base_commit:base,files};
 history.releases.unshift(release);fs.writeFileSync(file,JSON.stringify(history,null,2)+'\n');console.log(`Created ${release.id}: ${files.length} changed files`);
}
