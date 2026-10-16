const assert=require('node:assert/strict'),path=require('node:path');const dir=process.argv[2];let prompts=[],mode='normal',calls=0;
class FakeReviewClient {
 constructor(){this.messages={create:async req=>{
  calls++;prompts.push(req.system);
  if(mode==='broken'&&calls<3)return {content:[{type:'text',text:'{'}]};
  return {content:[{type:'text',text:'{"passed":true,"reason":"ok"}'}]};
 }}};
}
require.cache[require.resolve('@anthropic-ai/sdk')]={exports:{__esModule:true,default:FakeReviewClient}};
const review=require(path.join(dir,'reviewer.js'));
(async()=>{
 await review.independentlyValidate({skill:'avoid_repetition'},{phone:'test',messages:[]});assert.match(prompts.at(-1),/COMMUNICATION SKILL, not a phrase alias/);assert.doesNotMatch(prompts.at(-1),/FULL customer phrase/);
 await review.independentlyValidate({phrase:'location',intent:'request_location'},{phone:'test',messages:[]});assert.match(prompts.at(-1),/FULL customer phrase/);
 const redacted=review.safeEvidence({phone:'test',name:'Jane Smith',messages:[{role:'user',content:'Jane Smith jane@example.com +441234567890'}]})[0].content;assert.doesNotMatch(redacted,/Jane|Smith|example|441234/);
 calls=0;mode='broken';await review.jsonReview('test',{});assert.equal(calls,3);assert.equal(review.retryableReviewError(Error('Incomplete replay evaluation')),true);assert.equal(review.retryableReviewError(Error('Replay failed: regression or locked-rule risk')),false);
 const {Github}=require(path.join(dir,'github.js'));const gh=new Github();gh.request=async()=>[];
 global.fetch=async()=>({ok:true,json:async()=>({environment:'production',repository:'marcfmartens-hub/mw-whatsapp',commit:'new',learningHash:'hash'})});assert.equal(await gh.productionReady('old','hash'),true);assert.equal(await gh.productionReady('old','wrong'),false);
 global.fetch=async()=>({ok:true,json:async()=>({environment:'preview',repository:'marcfmartens-hub/mw-whatsapp',commit:'old',learningHash:'hash'})});assert.equal(await gh.productionReady('old','hash'),false);
 console.log('Separate validators, privacy masking, bounded technical retries and canonical production evidence passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
