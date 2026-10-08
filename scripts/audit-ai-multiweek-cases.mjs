import fs from 'node:fs';
import path from 'node:path';
const dir=path.resolve('evidence/ai-multiweek');
const unresolved=r=>r.kind==='close'&&!['closed','cancelled'].includes(r.data.phase)||r.kind==='task'&&!['closed','cancelled'].includes(r.data.phase);
const reports=[];
for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('-cases.json'))){
 const bundle=JSON.parse(fs.readFileSync(path.join(dir,file),'utf8')),errors=[],warnings=[];let previous,previousAt;
 if(bundle.cases.length!==28)errors.push('Expected 28 consecutive daily cases.');
 for(const [index,c]of bundle.cases.entries()){
  if(c.day!==index+1||c.week!==Math.floor(index/7)+1||c.dayInWeek!==index%7+1)errors.push(`Day ${c.day}: calendar indexes inconsistent.`);
  if(!c.question||!c.followup)errors.push(`Day ${c.day}: two questions are required.`);
  const at=Date.parse(c.at),end=Date.parse(c.followupAt??c.at)+6000;
  if(!Number.isFinite(at)||!Number.isFinite(end)||end<at)errors.push(`Day ${c.day}: invalid/reversed date.`);
  if(previousAt!==undefined&&at<=previousAt)errors.push(`Day ${c.day}: clock moves backwards across days.`);
  previousAt=end;
  for(const [label,w,focus]of[['arrival',c.workspace,c.selected],['follow-up',c.followupWorkspace??c.workspace,c.followupSelected]]){
   if(new Set(w.records.map(r=>r.id)).size!==w.records.length)errors.push(`Day ${c.day} ${label}: duplicate work IDs.`);
   if(!w.members.some(m=>m.id===w.me.id&&m.locationId===w.location.id))errors.push(`Day ${c.day} ${label}: current restaurant membership missing.`);
   if(focus&&!w.records.some(r=>r.id===focus.id&&r.revision===focus.revision))errors.push(`Day ${c.day} ${label}: attached work missing or wrong revision.`);
  }
  if(previous&&previous.location.id===c.workspace.location.id){
   for(const old of previous.records.filter(unresolved)){
    if(!c.workspace.records.some(r=>r.id===old.id))errors.push(`Day ${c.day}: unresolved ${old.kind} ${old.id} disappears from next-day snapshot.`);
   }
  }
  if(!Array.isArray(c.events)||!c.events.length)warnings.push(`Day ${c.day}: no explicit human fixture-event description.`);
  previous=c.afterWorkspace??c.followupWorkspace??c.workspace;
 }
 reports.push({file,role:bundle.role,days:bundle.cases.length,questions:bundle.cases.filter(c=>c.question).length+bundle.cases.filter(c=>c.followup).length,errors,warnings});
}
fs.writeFileSync(path.join(dir,'case-audit.json'),JSON.stringify({at:new Date().toISOString(),roles:reports.length,reports},null,2)+'\n');
for(const r of reports)console.log(JSON.stringify({role:r.role,days:r.days,errors:r.errors,warnings:r.warnings}));
if(reports.some(r=>r.errors.length))process.exitCode=1;
