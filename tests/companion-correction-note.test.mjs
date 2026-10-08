import test from 'node:test';
import assert from 'node:assert/strict';
import {companionCorrectionNote,reportsRework,requestsCorrectionNote} from '../.sites-runtime/shared/companion-correction-note.mjs';
const at='2026-10-11T23:00:00Z',model='MODEL: Corrected; another physical check requested.';
function fixture(){
 const person=(id,position='Host',capabilities=[])=>({id,locationId:'berts',name:id,position,area:'FOH',capabilities,qualifications:[],scheduleJobs:[position]});
 const me=person('Morgan'),manager=person('Casey','FOH Manager',['tasks.manage','close.confirm']),senior=person('Jordan','Server',['close.verify']);
 const record=(id,kind,ownerId,data)=>({id,kind,ownerId,data,locationId:'berts',area:'FOH',revision:1,updatedAt:at});
 const guide=record('guide','standard','Casey',{title:'Host close',position:'Host',zone:'Podium',version:1,status:'approved',source:'Fictional fixture only',validationNote:'Fictional',verification:'manager',criteria:['Booster clean'],history:[],guide:{purpose:'Fictional',preparation:[],steps:['Follow the approved cleaning method'],troubleshooting:[],escalation:'Ask Casey'}});
 const shift=record('shift','shift','Morgan',{personId:'Morgan',position:'Host',start:'2026-10-11T16:00:00Z',end:'2026-10-11T22:00:00Z',published:true,cancelled:false});
 const close=record('close','close','Morgan',{shiftId:'shift',standardId:'guide',standardRevision:1,standard:structuredClone(guide.data),managerId:'Casey',due:shift.data.end,phase:'correction',history:[{actorId:'Casey',action:'fix',note:'Booster still sticky. Correct it using the approved method and request another physical check.',at:'2026-10-11T21:00:00Z'}]});
 const w={location:{id:'berts',name:'Fictional Bert’s',timezone:'America/New_York',revision:1},me,members:[me,manager,senior],records:[guide,shift,close]};
 const source={id:close.id,kind:close.kind,revision:close.revision,title:guide.data.title};
 return {w,guide,shift,close,source,manager,senior};
}
const noteQuestion='Casey returned my close. My shift ended. What is next, and can you help me word a note?';
test('mixed completed and unfinished reports retain actual cleanup without treating conditional cleanup as performed',()=>{
 assert.equal(reportsRework('I cleaned the mixing bowl area, but I have not checked underneath or sent the pans to Dish. Help me write a note.'),true);
 assert.equal(reportsRework('I cleaned the mixing bowl and haven’t checked underneath. Give me a note.'),true);
 assert.equal(reportsRework('If I cleaned the mixing bowl but I haven’t checked underneath, what note could I write?'),false);
 assert.equal(reportsRework('I haven’t cleaned the mixing bowl or checked underneath. Help me write a note.'),false);
});
test('actual pre-rework failure is replaced with pending facts, actual checks and separate release without mutation',()=>{
 const f=fixture(),before=JSON.stringify(f.w),answer=companionCorrectionNote(f.w,[f.source],noteQuestion,model,at,f.source);
 assert.notEqual(answer,model);assert.match(answer,/Latest saved checker instruction: "Booster still sticky/);
 assert.match(answer,/"Saved correction remains open; correction and another physical check are still needed\."/);
 assert.doesNotMatch(answer,/Corrected;|another physical check requested/);
 assert.match(answer,/chooses Ready for physical check/);assert.match(answer,/Ready is a request, not completion/);
 assert.match(answer,/Casey performs the independent physical check/);assert.match(answer,/separate manager release/);
 assert.match(answer,/Chat does not save the note, submit Ready, notify anyone/);assert.equal(JSON.stringify(f.w),before);
});
test('direct reported rework retains model answer; hypothetical, negated and proposed-note text do not establish done work',()=>{
 const f=fixture();
 for(const q of ['I’ve wiped the booster again now. Help me write a note.','I fixed it. What note should I use?','I completed the correction. Help me word a note.'])assert.equal(companionCorrectionNote(f.w,[f.source],q,model,at),model);
 for(const q of ['If I wiped it again, what note should I write?','When I have corrected it, what note should I write?','I have not corrected it yet. Help me write a note.','Can I say I fixed it in my note?','Help me write a note saying “I fixed it”.','I will wipe it. Help me word a note.'])assert.notEqual(companionCorrectionNote(f.w,[f.source],q,model,at),model,q);
});
test('reported debris removal and coordinated cleanup preserve factual worker reports without saving readiness or approval',()=>{
 const f=fixture(),before=JSON.stringify(f.w);
 const reported='Worker reports crumbs removed and table cleaned; no physical check or Ready submission is recorded.';
 for(const q of [
  'I removed the crumbs and cleaned the table. Give me a short truthful note I can put in the closing work, and tell me what happens next.',
  'We cleared the debris and scrubbed underneath. Help me write a note.',
  'I moved the table and cleaned underneath. Help me write a note.',
  'I have removed the crumbs. Help me write a note.'
 ])assert.equal(companionCorrectionNote(f.w,[f.source],q,reported,at,f.source),reported,q);
 assert.equal(JSON.stringify(f.w),before);
 assert.equal(f.close.data.phase,'correction');assert.equal(f.shift.data.releasedAt,undefined);
 for(const q of [
  'If I removed the crumbs and cleaned the table, what note should I write?',
  'I did not remove the crumbs and clean the table. Help me write a note.',
  'I have not removed the crumbs and cleaned the table. Help me write a note.',
  'I haven’t removed the crumbs and cleaned the table. Help me write a note.',
  'I removed no crumbs and did not clean the table. Help me write a note.',
  'Can I say I removed the crumbs and cleaned the table in my note?',
  'Help me write a note saying I removed the crumbs and cleaned the table.',
  'Help me write a note saying “I removed the crumbs and cleaned the table”.',
  'I will remove the crumbs and clean the table. Help me write a note.',
  'I removed the correction note. Help me write a note.'
 ]){
  const answer=companionCorrectionNote(f.w,[f.source],q,reported,at,f.source);
  assert.notEqual(answer,reported,q);assert.match(answer,/Saved correction remains open/);
  assert.doesNotMatch(answer,/Worker reports crumbs removed/);
 }
 assert.equal(JSON.stringify(f.w),before);
});
test('reporting questions before rework use pending facts, never an unreported ongoing-cleanup note',()=>{
 const f=fixture(),before=JSON.stringify(f.w);
 const q='My manager returned my Rudd’s pizza close because crumbs are still under the table. What should I do now and how do I report it?';
 assert.equal(requestsCorrectionNote(q),true);assert.equal(reportsRework(q),false);
 const answer=companionCorrectionNote(f.w,[f.source],q,'Crumbs remain; cleaning again; not Ready yet.',at,f.source);
 assert.match(answer,/Saved correction remains open; correction and another physical check are still needed/);
 assert.doesNotMatch(answer,/cleaning again|cleaned area|ready for another check/i);
 assert.match(answer,/Once every required condition is actually met/);
 assert.equal(JSON.stringify(f.w),before);
 assert.equal(requestsCorrectionNote('What is my station today?'),false);
 assert.equal(reportsRework('I removed the crumbs and cleaned the table. Give me a truthful note.'),true);
 for(const text of [
  'If I removed the crumbs and cleaned the table, what should I report?',
  'I did not remove the crumbs and clean the table. How do I report it?',
  'I will remove the crumbs and clean the table. How should I report it?',
  'Help me write a note saying I removed the crumbs and cleaned the table.'
 ])assert.equal(reportsRework(text),false,text);
});
test('two checker order and helper responsibility use current saved people rather than assigning manager the correction',()=>{
 const f=fixture();f.w.members.push({...f.senior,id:'Taylor',name:'Taylor',capabilities:[],qualifications:['Host']});f.close.data.verifierId='Jordan';f.close.data.standard.verification='senior-then-manager';f.close.data.correction={personId:'Taylor',assignedBy:'Casey',assignedAt:at,note:'Fictional helper'};f.w.me=f.manager;
 const answer=companionCorrectionNote(f.w,[f.source],noteQuestion,model,at,f.source);
 assert.match(answer,/Taylor follows the saved correction instruction/);assert.match(answer,/Jordan performs the first independent physical check/);assert.match(answer,/Casey then performs a separate final physical confirmation, even if the first check passes/);assert.doesNotMatch(answer,/Casey follows the saved correction/);
});
test('missing and retired methods stop at named manager; no chemicals or operating steps are fabricated',()=>{
 for(const missing of ['steps','retired']){
  const f=fixture();if(missing==='steps'){delete f.guide.data.guide;delete f.close.data.standard.guide}else f.guide.data.status='retired';
  const answer=companionCorrectionNote(f.w,[f.source],noteQuestion,model,at);
  assert.match(answer,missing==='steps'?/approved guide has no detailed method.*Ask Casey for the approved correction method/:/instructions are no longer current.*Ask Casey to update them/);
  assert.doesNotMatch(answer,/bleach|sanitizer concentration|contact time|\d+ degrees/i);
 }
});
test('stale, ambiguous, unrelated, private and non-correction work cannot supply a replacement',()=>{
 const f=fixture();assert.equal(companionCorrectionNote(f.w,[{...f.source,revision:0}],noteQuestion,model,at),model);
 assert.equal(companionCorrectionNote(f.w,[f.source],noteQuestion,model,at,{id:'another-shift',kind:'shift',revision:1,title:'Other shift'}),model);
 assert.equal(companionCorrectionNote(f.w,[f.source],'What is my seating rotation?',model,at),model);
 for(const phase of ['open','verification','manager-confirmation','closed','cancelled']){const c=fixture();c.close.data.phase=phase;assert.equal(companionCorrectionNote(c.w,[c.source],noteQuestion,model,at),model)}
 const extra=structuredClone(f.close);extra.id='other-close';extra.ownerId='PRIVATE_WORKER';extra.data.history[0].note='PRIVATE_STICKY_FIX';f.w.records.push(extra);
 const privateSource={...f.source,id:extra.id};assert.equal(companionCorrectionNote(f.w,[privateSource],noteQuestion,model,at,privateSource),model);
 const ownSecond=structuredClone(f.close);ownSecond.id='second-own-close';f.w.records.push(ownSecond);
 assert.equal(companionCorrectionNote(f.w,[f.source,{...f.source,id:ownSecond.id}],noteQuestion,model,at),model);
 const answer=companionCorrectionNote(f.w,[f.source,privateSource],noteQuestion,model,at,f.source);assert.doesNotMatch(answer,/PRIVATE_STICKY_FIX|PRIVATE_WORKER/);
});
