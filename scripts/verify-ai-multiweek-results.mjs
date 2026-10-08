import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const dir='evidence/ai-multiweek';
const roles=['server','host','back-window','pizza','prep-cook','gm'];
const results=[];
for(const role of roles){
 const file=`${dir}/${role}-replies-verified.json`,data=JSON.parse(fs.readFileSync(file));
 assert.equal(data.realProvider,true);assert.match(data.status,/captured/);
 assert.equal(data.results.length,28);
 let citations=0,emptyCitations=0;
 for(const [index,day] of data.results.entries()){
  assert.equal(day.day,index+1);assert.equal(day.week,Math.ceil((index+1)/7));assert.equal(day.turns.length,2);
  for(const turn of day.turns){
   assert.equal(turn.status,'completed');assert.equal(turn.appStatus,200);assert.equal(turn.providerMeta.status,200);assert.equal(turn.workUnchanged,true);
   assert.ok(turn.answer.trim().length>0);
   const available=turn.context.evidence.map(e=>e.source);
   if(!turn.sources.length)emptyCitations++;
   for(const source of turn.sources){assert.ok(available.some(a=>a.id===source.id&&a.kind===source.kind&&a.revision===source.revision),`${role} day${day.day}: unavailable citation`);citations++;}
  }
 }
 for(const rotation of data.continuity.rotations){assert.equal(rotation.appStatus,200);assert.equal(rotation.workUnchanged,true);assert.equal(rotation.archivedTurns,14);}
 results.push({role,days:28,realReplies:56,citations,emptyCitationReplies:emptyCitations,weeklyArchives:data.continuity.rotations.length,workUnchanged:true,compiledFingerprint:data.compiledFingerprint,captureSha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')});
}
assert.equal(new Set(results.map(r=>r.compiledFingerprint)).size,1,'Final roles must use the same compiled source');
const receipt={status:'passed',boundary:'Execution and citation integrity only; independent grades judge helpfulness and correctness.',roleDays:168,realReplies:336,results};
fs.writeFileSync(`${dir}/integrity.json`,JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt));
