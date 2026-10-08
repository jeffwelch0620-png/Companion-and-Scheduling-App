import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {localDate,localClock,nextDate} from '../.sites-runtime/shared/local-time.mjs';

const root=process.argv[2]??'evidence/hour-trial/final-multiweek';
const summary=JSON.parse(fs.readFileSync(path.join(root,'multiweek-summary.json'),'utf8'));
const audit={createdAt:new Date().toISOString(),layer:'Independent readback of retained actual saved shift records and conversations from SQLite databases',sourceRevision:summary.sourceRevision,profiles:[],failures:[]};
for(const profile of summary.profiles){
 let db;
 try{
  const receipt=JSON.parse(fs.readFileSync(path.join(root,profile.receipt),'utf8'));
  db=new DatabaseSync(path.join(root,profile.database),{readOnly:true});
  const turns=db.prepare('SELECT COUNT(*) AS n FROM companion_turns').get().n;
  assert.equal(turns,21,'Saved conversation must retain all three weeks');
  assert.equal(receipt.days.length,21);
  const startClock=receipt.days[0].actualShift.startClock,endClock=receipt.days[0].actualShift.endClock;
  for(const [index,day] of receipt.days.entries()){
   const record=db.prepare('SELECT data FROM records WHERE id=?').get(day.actualShift.id);
   assert.ok(record,'Actual published shift must still exist on disk');
   const saved=JSON.parse(record.data);
   assert.equal(saved.start,day.actualShift.start);assert.equal(saved.end,day.actualShift.end);
   assert.equal(localDate(saved.start,'America/New_York'),day.businessDate);
   assert.equal(localClock(saved.start,'America/New_York'),startClock);
   assert.equal(localClock(saved.end,'America/New_York'),endClock);
   if(index)assert.equal(day.businessDate,nextDate(receipt.days[index-1].businessDate));
  }
  const before=receipt.days.find(day=>day.businessDate==='2026-10-31'),after=receipt.days.find(day=>day.businessDate==='2026-11-01');
  assert.ok(before&&after,'Audit requires a DST-spanning receipt');assert.equal(after.dayStart-before.dayStart,25*3600000);
  audit.profiles.push({profileId:profile.id,persistedShiftChecks:21,savedConversationTurns:turns,fixedLocalOpeningAndEndClocks:true,twentyFiveHourDay:true,operationalReseeds:receipt.operationalReseeds});
 }catch(error){audit.failures.push({profileId:profile.id,error:String(error.stack??error)});}
 finally{db?.close();}
}
audit.totalPersistedShiftChecks=audit.profiles.reduce((n,p)=>n+p.persistedShiftChecks,0);
audit.totalSavedConversationTurns=audit.profiles.reduce((n,p)=>n+p.savedConversationTurns,0);
fs.writeFileSync(path.join(root,'calendar-audit.json'),JSON.stringify(audit,null,2));
console.log(JSON.stringify({profiles:audit.profiles.length,persistedShiftChecks:audit.totalPersistedShiftChecks,savedTurns:audit.totalSavedConversationTurns,failures:audit.failures.length}));
assert.deepEqual(audit.failures,[]);assert.equal(audit.profiles.length,42);
