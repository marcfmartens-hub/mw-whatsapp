const assert=require('node:assert/strict'),path=require('node:path');
const dir=process.argv[2];
const {DEFAULT_CONFIG}=require(path.join(dir,'config.js'));
let current={...DEFAULT_CONFIG,enabled:false},calls=[];
const latest={};
const chain={select(){return this},eq(_k,v){this.kind=v;return this},order(){return this},async limit(){return{data:latest[this.kind]?[{started_at:latest[this.kind]}]:[],error:null}}};
require.cache[require.resolve(path.join(dir,'store.js'))]={exports:{settings:async()=>({config:current}),improveDb:()=>({from:()=>Object.create(chain)})}};
require.cache[require.resolve(path.join(dir,'runner.js'))]={exports:{runCheck:async(...args)=>{calls.push(args)}}};
process.env.VERCEL_ENV='production';
const {afterBiginPush}=require(path.join(dir,'events.js'));
(async()=>{
 const chat={phone:'test',messages:[]};await afterBiginPush(chat);assert.equal(calls.length,0);
 current={...DEFAULT_CONFIG,enabled:true};await afterBiginPush(chat);assert.equal(calls.length,5);assert.equal(calls.every(c=>c[1]==='bigin'&&c[2]==='test'&&c[3]===chat),true);
 calls=[];latest.review=new Date().toISOString();latest.regression=new Date().toISOString();await afterBiginPush(chat);assert.deepEqual(calls.map(c=>c[0]),['confirmation','reply','outcome']);
 calls=[];current={...current,schedules:{...current.schedules,reply:{mode:'off',minutes:0}}};await afterBiginPush(chat);assert.deepEqual(calls.map(c=>c[0]),['confirmation','outcome']);
 calls=[];process.env.VERCEL_ENV='preview';await afterBiginPush(chat);assert.equal(calls.length,0);
 console.log('Bigin-only triggering, disabled switch, interval gating, per-run Off and preview isolation passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
