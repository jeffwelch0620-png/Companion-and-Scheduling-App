import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runPositionWeek,openPositionDatabase} from './all-position-week-fixture.mjs';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {handleCompanionChat} from '../.sites-runtime/shared/companion-chat.mjs';

export const managementProfiles=['berts','rudds','papa'].map(restaurant=>({
 id:`${restaurant}-general-manager`,restaurant,position:'General manager',area:'BOH',
 capabilities:['location.manage','tasks.manage','people.manage','standards.approve','schedule.manage','schedule.publish','schedule.change','close.confirm','operations.escalation'],
 opening:['Read unresolved Red Book work, check staffing and department readiness.','Review sales and labor to plan upcoming staffing; confirm manager coverage.'],
 service:['Coordinate FOH and BOH managers; support staff are normally cut first when duties can be covered and servers last.','Remain accountable for BOH checks during the BOH manager absence; explicitly delegate the actual checks.','Keep guest recovery, prep shortages and incomplete work visible.'],
 closing:['Check department close and unresolved work, complete the restaurant-specific cash oversight and pass unfinished work to the final closer.','Verify the dining room, bathrooms and entrances; confirm next-day prep planning.'],
 goal:'Coordinate coverage and require independent evidence before checkout.',
 ...(restaurant==='papa'?{shiftStartHour:15,shiftEndHour:23}:{}),
 provenance:{kind:'owner-confirmed management walkthrough',source:'Current joint-owner transcript; same management baseline at all three locations, separate cash routines.'},
 dailyScenarios:[
 ['Absent BOH manager','BOH manager cannot work.','GM remains accountable and appoints checks rather than assuming they happened.'],
 ['Support cut and coverage','Business slows while remaining support duties still need coverage.','Coordinate FOH/BOH; assign remaining work before release.'],
 ['Failed department close','Independent checker finds incomplete cleaning.','Retain correction and require reinspection; no self-approval.'],
 ['Prep shortage','Production reports less than planned.','Review actual quantity and remedy; do not make a second stock change.'],
 ['Guest recovery pending','Guest concern is unresolved at close.','Name the responsible person and retain follow-through.'],
 ['Unfinished next-day planning','A next-day prep sheet is not ready.','Preserve the missing sheet as manager-owned unfinished work.'],
 ['Interrupted final save','Connection drops after closing submission.','Reload the saved state and retry the same request safely.'],
 ].map(([title,detail,nextAction])=>({title,detail,nextAction})),
 knownGaps:['Local simulation does not reconcile actual cash, payroll, live Toast sales or the hosted Jeff release. Separate restaurant cash procedures remain source-specific.'],
}));

for(const profile of managementProfiles)test(`${profile.restaurant} GM: seven days of coverage, exceptions and independent checkout`,async()=>{
 const result=await runPositionWeek(profile);result.knownGaps=profile.knownGaps;
 fs.mkdirSync('evidence/all-position-week',{recursive:true});fs.writeFileSync(`evidence/all-position-week/${profile.id}.json`,JSON.stringify(result,null,2)+'\n');
 assert.deepEqual(result.failures,[]);assert.equal(result.days.length,7);assert.equal(result.aiContextRequests,7);assert.equal(result.operationalReseeds,0);
});

test('Jay and Rudd: seven daily persisted owner checks preserve unique seats and isolated restaurant context',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jmax-owner-week-')),file=path.join(dir,'owners.sqlite');let store=openPositionDatabase(file);const rows=[];
 const req=(person,loc,endpoint='workspace')=>new Request(`https://owner-week.example/api/${endpoint}?locationId=${loc}`,{headers:{'oai-authenticated-user-id':person+'-principal','oai-authenticated-user-email':person+'@example.test'}});
 try{
  for(const filename of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())store.sqlite.exec(fs.readFileSync('drizzle/'+filename,'utf8').replaceAll('--> statement-breakpoint',''));
  for(const loc of ['berts','rudds','papa','comm'])store.sqlite.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').run(loc,loc,'America/New_York');
  for(const person of ['jay','rudd','pretender']){
   for(const loc of ['berts','rudds','papa','comm'])store.sqlite.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?,?)').run(person+'-'+loc,person+'@example.test',person+'-principal',loc,'Fictional '+person,'BOH','Owner','["location.manage"]','[]');
   if(person!=='pretender')store.sqlite.prepare('INSERT INTO restaurant_access(auth_user_id,kind,home_location_id) VALUES(?,?,?)').run(person+'-principal',person,'berts');
  }
  for(let day=1;day<=7;day++){
   if(day>1){store.close();store=openPositionDatabase(file);}
   for(const person of ['jay','rudd'])for(const loc of ['berts','rudds','papa','comm']){
    const response=await handleWorkspace(req(person,loc),store.db);assert.equal(response.status,200);const value=await response.json();assert.equal(value.location.id,loc);assert.ok(value.records.every(r=>r.locationId===loc));
    const chat=await handleCompanionChat(req(person,loc,'companion'),store.db,{},async()=>{throw Error('GET must not use provider');},()=>Date.parse(`2026-10-${String(7+day).padStart(2,'0')}T12:00:00-04:00`),'workforce');assert.equal(chat.status,200);
    rows.push({day,person,restaurant:loc,workspace:'passed',chat:'passed'});
   }
   for(const loc of ['berts','rudds','papa','comm'])assert.equal((await handleWorkspace(req('pretender',loc),store.db)).status,403,'Owner label and extra memberships must not grant a third seat');
  }
  assert.throws(()=>store.sqlite.prepare('INSERT INTO restaurant_access(auth_user_id,kind,home_location_id) VALUES(?,?,?)').run('pretender-principal','jay','berts'),/UNIQUE/);
  fs.mkdirSync('evidence/all-position-week',{recursive:true});fs.writeFileSync('evidence/all-position-week/owner-week.json',JSON.stringify({days:7,ownerSeats:['jay','rudd'],checks:rows,operationalReseeds:0,limits:['Fictional verified identities; hosted owner identity binding remains unverified.','Owner scope and chat reads tested here; real generated responses are evaluated separately.']},null,2)+'\n');
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
