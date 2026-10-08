import type {ChatSource} from './companion-chat-types';

type Evidence={source:ChatSource;facts:Record<string,unknown>};
const obj=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};

/** A guide alone cannot supply an assigned close or a physical checker. This
 * boundary handles personal Back Window checkout when a current own shift is
 * supplied but its closing assignments are not. Assigned work uses the existing
 * closing workflow guard instead. Missing work is not proof no work exists. */
export function companionShiftReleaseBoundary(context:unknown,question:string):{answer:string;sources:ChatSource[]}|null{
 const c=obj(context),myShift=obj(c.myShift),selected=obj(c.selectedWork),status=obj(c.closingStatus);
 if(c.product!=='workforce'||!/\b(?:i|me|my|we|us|our)\b/i.test(question)||!/\b(?:check(?:ed|ing)?[ -]?out|check\s+(?:me|us)\s+out|release\s+(?:me|us|my\s+shift|our\s+shift)|(?:can|may)\s+(?:i|we)\s+(?:leave|go\s+home))\b/i.test(question))return null;
 if(['close','task','goal'].includes(String(selected.kind))||c.scopeMode==='selected-shift'||!['currently scheduled','scheduled shift ended; operational checkout pending'].includes(String(myShift.status)))return null;
 const evidence:Array<Evidence>=Array.isArray(c.evidence)?c.evidence.filter((e:unknown)=>{const row=obj(e),source=obj(row.source);return typeof source.id==='string'&&typeof source.revision==='number'&&typeof source.kind==='string';}).map((e:unknown)=>{const row=obj(e);return {source:row.source as ChatSource,facts:obj(row.facts)};}):[];
 const shift=evidence.find(e=>e.source.kind==='shift'&&e.source.id===myShift.sourceId);
 if(!shift||shift.facts.authority!=='published schedule'||shift.facts.published!==true||shift.facts.cancelled===true||shift.facts.releasedAt)return null;
 const now=Date.parse(String(c.asOf)),start=Date.parse(String(shift.facts.start));
 if(!Number.isFinite(now)||!Number.isFinite(start)||start>now)return null;
 if(!/\bback window\b/i.test(String(myShift.station??myShift.job)))return null;
 // An explicitly supplied close/task must retain its real performer, phase and
 // checks rather than receiving this no-assignment answer. The broader workflow
 // guard resolves those records from the authorized workspace.
 if(evidence.some(e=>e.source.kind==='close'||e.source.kind==='task'&&(e.facts.shiftId||e.facts.linkedShift||e.facts.closingHandoff))||Array.isArray(status.assignedCloses)&&status.assignedCloses.length||Array.isArray(status.linkedTasks)&&status.linkedTasks.length)return null;
 const guides=evidence.filter(e=>{
  const f=e.facts,g=obj(f.guide),steps=Array.isArray(g.steps)?g.steps.filter((s:unknown)=>typeof s==='string').join('\n'):'';
  return e.source.kind==='standard'&&f.authority==='approved standard'&&f.methodAvailable!==false&&f.instructionContentOmitted!==true&&/\bback window\b/i.test(String(f.zone??f.position))&&/\b(?:the\s+)?manager\s+closes?\s+the\s+cash\s+drawer\b/i.test(steps);
 });
 if(!guides.length)return null;
 const drawer=/\b(?:cash\s+)?drawer\b/i.test(question);
 const answer=[
  drawer?'No. The current approved Back Window guide assigns cash-drawer closeout to the manager. It does not authorize you to close the drawer. Chat cannot mark your shift checked out or release it.':'Chat cannot mark your shift checked out or release it.',
  'Your current saved published shift has no recorded release. The responsible manager must perform separate operational checkout before you leave. This is required for this unreleased shift; it is separate from payroll clock-out and does not change your scheduled hours.',
  'No linked closing assignment or assigned physical checker for this shift is supplied in this answer. A guide alone does not assign closing work or require you to submit Ready or request a named closing check. Follow the actual assigned work and any independent checks shown in its linked assignment; ask your manager to confirm missing assignment details.',
  drawer?'At changeover, pass along ready and pending orders, keep each ticket attached to its matching order, and tell Expo the exact missing or incorrect item before guest handoff.':''
 ].filter(Boolean).join('\n\n');
 return {answer,sources:[shift.source,guides[0].source]};
}
