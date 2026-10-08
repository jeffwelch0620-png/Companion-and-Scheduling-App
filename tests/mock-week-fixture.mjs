// Fictional role-separated week, shared by API tests and the built-app browser harness.
import {localDate,localInstant,nextDate} from '../.sites-runtime/shared/local-time.mjs';
export const weeklyAccounts=[
 ['worker','Sample Avery','FOH','Server',[]],
 ['senior','Sample senior verifier','FOH','Senior server',['close.verify']],
 ['manager','Sample FOH drafter','FOH','FOH manager',['schedule.manage','schedule.change','tasks.manage','close.confirm','standards.approve']],
 ['incoming','Sample Blair','FOH','Server',[]],
 ['dish','Sample Finley','BOH','Dishwasher',[]],
 ['publisher','Sample final publisher','FOH','Publisher',['schedule.publish','location.manage']],
 ['boh','Sample BOH drafter','BOH','BOH manager',['schedule.manage','schedule.change','tasks.manage','close.confirm','standards.approve']],
 ['admin','Sample administrator','FOH','Administrator',['location.manage']],
 ['server2','Sample Casey','FOH','Server',[]],
 ['cook','Sample Drew','BOH','Cook',[]],
 ['cook2','Sample Emery','BOH','Cook',[]],
 ['dish2','Sample Gray','BOH','Dishwasher',[]],
];
export async function seedMockWeek(db,command,{staffing=false}={}) {
 const zone='America/New_York',today=localDate(new Date().toISOString(),zone),weekday=new Date(today+'T12:00:00Z').getUTCDay();
 const start=nextDate(today,7-(weekday+6)%7),days=Array.from({length:7},(_,i)=>nextDate(start,i));
 await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind('review','Fictional weekly schedule rehearsal',zone).run();
 for(const [id,name,area,position,caps] of weeklyAccounts)await db.prepare('INSERT INTO memberships(id,email,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?)').bind(id,id+'@example.test','review',name,area,position,JSON.stringify(caps),JSON.stringify([position])).run();
 const ok=async(actor,action,input,record)=>{const r=await command(actor,action,input,record);if(r.status!==200)throw Error(action+': '+JSON.stringify(r.data));return r.data};
 const period=(day,from,to,next=false)=>({start:localInstant(day,from,zone),end:localInstant(next?nextDate(day):day,to,zone)});
 const school=await ok('worker','availability.save',{title:'Fictional school term',kind:'school',startDate:start,endDate:days[6],days:[1,3,5],startMinute:480,endMinute:900,beforeMinutes:0,afterMinutes:30,excludedDates:[]});
 await ok('manager','availability.review',{approve:true,note:'Fictional school and travel window'},school);
 const off=await ok('incoming','request.create',{type:'time-off',...period(days[2],'00:00','00:00',true),note:'Fictional Wednesday off'});
 await ok('manager','request.review',{approve:true,note:'Fictional day off approved'},off);
 const standards={};
 for(const [actor,position] of [['manager','Server'],['boh','Cook']]){
  let s=await ok(actor,'standard.save',{title:'Mock '+position+' close',zone:'Mock '+position+' station',position,version:1,criteria:['Sample surfaces restored','Sample supplies counted'],verification:actor==='manager'?'senior-then-manager':'manager',source:'Fictional software rehearsal only; not a restaurant SOP.'});
  s=await ok(actor,'standard.approve',{validated:true,note:'Approved only for this isolated fictional rehearsal'},s);standards[actor]=s;
 }
 const drafts=[],closes=[];
 for(let i=0;i<7;i++){
  const day=days[i],night=period(day,'16:00',i===6?'01:00':'23:00',i===6);
  for(const [actor,area] of [['manager','FOH'],['boh','BOH']])await ok('publisher','leadership.assign',{personId:actor,area,...period(day,'10:00',i===6?'02:00':'23:59',i===6),note:'Fictional assigned shift leadership'});
  const slots=[['manager',i%2?'incoming':'server2','Server',period(day,'11:00','16:00'),false],['manager',i%2?'server2':'worker','Server',night,true],['boh',i%2?'cook2':'cook','Cook',night,true],['boh',i%2?'dish2':'dish','Dishwasher',night,false]];
  for(const [actor,personId,position,p,closing] of slots){
   const s=await ok(actor,'shift.save',{personId,position,...p,note:'Fictional weekly draft'});drafts.push(s);
   if(closing)closes.push(await ok(actor,'close.assign',{shiftId:s.recordId,standardId:standards[actor].recordId,managerId:actor,...(actor==='manager'?{verifierId:'senior'}:{}),due:p.end}));
  }
 }
 if(staffing){
  const need=await ok('manager','staffing.save',{title:'Mock Monday dinner coverage',area:'FOH',position:'Server',...period(start,'16:00','23:00'),minimum:2,source:'Fictional software rehearsal only; not a restaurant staffing rule.'});
  await ok('publisher','staffing.approve',{confirmed:true,note:'Fictional staffing need for local browser rehearsal'},need);
 }
 return {start,days,zone,drafts,closes,period};
}
