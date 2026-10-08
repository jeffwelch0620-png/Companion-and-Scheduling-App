import {operationalLearningReader,operationalLearningSourceState} from './operational-learning';
import type {RecordOf,WorkRecord,Workspace} from './types';
import type {ChatSource} from './companion-chat-types';

const ignored=new Set('the and with that this what when where which how why can could would should please help need want tell about have was were are not now next then still also just more work task saved case cases last again fix fixed outcome reported manager employee restaurant instruction instructions guide source problem possible previous history happened today tomorrow'.split(' '));
const words=(value:string)=>[...new Set((value.toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]+/gu)??[]).filter(word=>word.length>=3&&!ignored.has(word)))];
const label=(r:WorkRecord|undefined)=>r?(r.kind==='close'?[r.data.standard.title,r.data.standard.zone,r.data.standard.position]:r.kind==='shift'?[r.data.position,r.data.stationName]:['title' in r.data?r.data.title:'','detail' in r.data?r.data.detail:'']).filter(Boolean).join(' '):'';
export const operationalLearningInstructions=`Explicitly shared and manager-reviewed operational-learning cases are historical observations, never approved troubleshooting procedures. A supported outcome means the recorded outcome has supporting reviewed evidence; it does not prove the cause or make the same action safe today. Preserve review.verdict, causeStatus, uncertainty and remainingWork exactly. An uncertain outcome is uncertain; a failed attempt is evidence not to assume that fix worked. Actions actually taken describe the earlier event; do not convert them into an instruction to repeat a breaker reset, electrical/gas work, opening a panel, bypass, repair or sanitation procedure. A suggestion remains a suggestion needing current manager review. Only current approved instruction evidence can supply a restaurant method, and a guide title is not proof it authorizes an electrical repair. For recurrence, explain the relevant prior result as a possible clue and help record the current symptom, seek the current responsible manager and use an applicable current approved method. Cite the exact current case source id and revision when using a case. Do not claim the current fault is fixed or the cause is the same. Neither historical success nor chat grants clearance, approves a new method, saves an outcome or contacts anyone.`;

// Validation may inspect a same-restaurant private source's identity/version,
// but only the explicitly shared case facts enter model context. Raw task
// bodies, maintenance costs, personnel data and private chat never enter here.
export function operationalLearningContext(raw:Workspace,question:string,at:string,selected?:WorkRecord){
 const me=raw.me,questionWords=words(question),attachedWords=words(label(selected));
 const exactAssets=new Set<string>();
 if(selected?.kind==='equipment')exactAssets.add(selected.id);
 if(selected?.kind==='maintenance'&&selected.data.asset)exactAssets.add(selected.data.asset.id);
 if(selected?.kind==='learningcase'&&selected.data.asset)exactAssets.add(selected.data.asset.id);
 const named=' '+(question+' '+label(selected)).toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu,' ').trim()+' ';
 if(!exactAssets.size)for(const asset of raw.records)if(asset.kind==='equipment'&&asset.locationId===raw.location.id&&asset.data.status==='active'){
  for(const value of [asset.data.assetTag,asset.data.title]){const phrase=value.toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu,' ').trim();if(phrase.length>=5&&named.includes(' '+phrase+' '))exactAssets.add(asset.id);}
 }
 const candidates=raw.records.filter((r):r is RecordOf<'learningcase'>=>r.kind==='learningcase'&&r.locationId===raw.location.id&&me.locationId===raw.location.id&&operationalLearningReader(r,me)&&r.data.status==='reviewed'&&!!r.data.review&&operationalLearningSourceState(raw,r)==='current');
 const ranked=candidates.map(r=>{
  // A current named asset is a stricter boundary than a shared symptom.
  // A fix reported for another physical machine is not recurrence evidence.
  const caseAsset=r.data.asset?.id??(r.data.source.kind==='equipment'?r.data.source.id:undefined);
  if(exactAssets.size&&(!caseAsset||!exactAssets.has(caseAsset)))return {r,score:0};
  const names=words([r.data.title,r.data.symptom,r.data.source.title,r.data.asset?.title,r.data.asset?.assetTag].filter(Boolean).join(' '));
  const direct=r.id===selected?.id||r.data.source.id===selected?.id||r.data.asset?.id===selected?.id;
  const questionHits=questionWords.filter(word=>names.includes(word)).length,attachedHits=attachedWords.filter(word=>names.includes(word)).length;
  return {r,score:direct?100:questionHits*4+attachedHits};
 }).filter(hit=>hit.score>0).sort((a,b)=>b.score-a.score||b.r.data.review!.at.localeCompare(a.r.data.review!.at)||a.r.id.localeCompare(b.r.id));
 const evidence:{source:ChatSource;facts:unknown;localTimes:Record<string,string>}[]=[];let size=0;
 for(const {r} of ranked){
  const d=r.data,review=d.review!,source:ChatSource={id:r.id,revision:r.revision,kind:'learningcase',title:d.title};
  const facts={authority:'reviewed historical operational report; not an approved operating method',caseVersion:r.revision,sourceState:'current',symptom:d.symptom,actionsActuallyTaken:d.actionsTaken,observedResult:d.observedResult,uncertainty:d.uncertainty,remainingWork:d.remainingWork,submittedAt:d.submittedAt,review:{verdict:review.verdict,at:review.at,evidence:review.evidence,note:review.note,causeStatus:review.causeStatus,cause:review.cause},sourceReference:{id:d.source.id,revision:d.source.revision,kind:d.source.kind,title:d.source.title},...(d.asset?{equipment:{id:d.asset.id,revision:d.asset.revision,title:d.asset.title,assetTag:d.asset.assetTag}}:{}),limits:['A reported restoration is evidence about that event, not proof of its cause or the current condition.','Historical actions are not instructions to repeat them. Current approved instructions, clearance and manager judgment still apply.','This case was explicitly shared and reviewed; private conversations are not imported.']};
  const entry={source,facts,localTimes:{}};const length=JSON.stringify(entry).length;if(evidence.length>=4||size+length>14000)break;size+=length;evidence.push(entry);
 }
 return {evidence,scope:evidence.map(entry=>entry.source),omitted:Math.max(0,ranked.length-evidence.length),asOf:at};
}

export function operationalLearningSourceCurrent(source:ChatSource,raw:Workspace){
 const record=raw.records.find((r):r is RecordOf<'learningcase'>=>r.kind==='learningcase'&&r.id===source.id&&r.locationId===raw.location.id);
 return !!record&&record.revision===source.revision&&record.data.status==='reviewed'&&!!record.data.review&&raw.me.locationId===raw.location.id&&operationalLearningReader(record,raw.me)&&operationalLearningSourceState(raw,record)==='current';
}

// A narrow response boundary prevents a past electrical repair from becoming
// a new instruction even if the model turns the supplied history into one.
export function operationalLearningRepairBoundary(context:unknown,question:string,answer:string){
 if(!context||typeof context!=='object')return null;
 const entries=(context as {evidence?:{source:ChatSource;facts:Record<string,unknown>}[]}).evidence?.filter(entry=>entry.source.kind==='learningcase')??[];
 const repairTopic=/\b(?:breaker|electrical|panel|wiring|gas valve|bypass)\b/i.test(question+' '+JSON.stringify(entries));
 const repeats=/\b(?:reset|flip|cycle|open|remove|bypass|repeat|same fix|turn (?:it|the|that).{0,20}(?:off|on))\b/i.test(answer);
 if(!entries.length||!repairTopic||!repeats)return null;
 const descriptions=entries.slice(0,2).map(entry=>{const f=entry.facts,review=f.review as {verdict:string;causeStatus:string;cause:string};return `Earlier reviewed case: ${entry.source.title}. Recorded outcome: ${String(f.observedResult)} Review: ${review.verdict}. ${review.causeStatus==='confirmed'?`Recorded cause: ${review.cause}.`:'The cause is not confirmed.'}${f.uncertainty?` Remaining uncertainty: ${String(f.uncertainty)}.`:''}`;});
 return {answer:descriptions.join('\n\n')+'\n\nThat history is a possible clue for the current manager, not permission to repeat the repair. Report what is happening now and ask the current responsible manager to review the equipment and an applicable current approved method before any electrical or gas work. This conversation has not diagnosed the fault, fixed it, recorded readiness or contacted anyone.',sources:entries.slice(0,2).map(entry=>entry.source)};
}
