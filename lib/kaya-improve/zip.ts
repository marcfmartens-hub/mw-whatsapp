// ZIP store format: no compression dependency; preserves exact UTF-8 file contents.
import { createHash } from "crypto";
const crc32=(b:Buffer)=>{let c=0xffffffff;for(const n of b){c^=n;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};
export function backupZip(release:{id:string;files:{path:string;before:string|null;after:string|null;status:string}[]}) {
 const entries:{name:string;data:Buffer}[]=[{name:"manifest.json",data:Buffer.from(JSON.stringify({...release,files:release.files.map(f=>({path:f.path,status:f.status,before_sha256:f.before===null?null:createHash("sha256").update(f.before).digest("hex"),after_sha256:f.after===null?null:createHash("sha256").update(f.after).digest("hex")}))},null,2))}];
 for(const f of release.files)for(const side of ["before","after"] as const)if(f[side]!==null)entries.push({name:`${side}/${f.path}`,data:Buffer.from(f[side]!)});
 const chunks:Buffer[]=[],directory:Buffer[]=[];let offset=0;
 for(const e of entries){const name=Buffer.from(e.name),crc=crc32(e.data),local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt32LE(crc,14);local.writeUInt32LE(e.data.length,18);local.writeUInt32LE(e.data.length,22);local.writeUInt16LE(name.length,26);
 const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt32LE(crc,16);central.writeUInt32LE(e.data.length,20);central.writeUInt32LE(e.data.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);directory.push(central,name);chunks.push(local,name,e.data);offset+=local.length+name.length+e.data.length;}
 const dir=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(dir.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...chunks,dir,end]);
}
