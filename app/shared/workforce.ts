import { has, manages, type Member, type Workspace, type RecordOf, type StationLevel } from './types';
import type { CommandContext } from './followthrough';
import { canPlan } from './schedule-review';
import { object, requireThat, text } from './validation';
import { readStationSetup } from './station-assignment';

// Levels are station-owned definitions, separate from access qualifications and
// the legacy 0–10 development review. No implicit score conversion exists.
export const defaultStationLevels=():StationLevel[]=>Array.from({length:5},(_,i)=>({value:i+1,label:`Level ${i+1}`,definition:''}));
export const workforceReader=(me:Member,area:string)=>me.position!=='Dishwasher'&&(manages(me,area,'people.manage')||canPlan(me,area)||has(me,'location.manage'));
export function activeStations(w:Workspace) {return w.records.filter((r):r is RecordOf<'station'>=>r.kind==='station'&&r.locationId===w.location.id&&r.data.status==='active');}
export function stationProficiency(w:Workspace,personId:string,station:RecordOf<'station'>) {
  const record=w.records.find((r):r is RecordOf<'proficiency'>=>r.kind==='proficiency'&&r.locationId===w.location.id&&r.ownerId===personId&&r.data.stationId===station.id);
  const current=!!record&&record.data.stationRevision===(station.data.definitionRevision??station.revision)&&station.data.status==='active';
  return {record,current,level:current?station.data.levels.find(l=>l.value===record.data.level):undefined,trainer:current&&record.data.certifiedTrainer===true};
}
export function applyWorkforce(c:CommandContext) {
  const {w,me,command,input,member,permitted,find,save,create,notify,history,at}=c;
  requireThat(me.position!=='Dishwasher','Dish uses Schedule and Inbox.',403);
  if(command.action==='station.save') {
    const existing=command.recordId?find('station'):undefined;
    const area=existing?.area??text(input.area??me.area,'Department',50);
    requireThat(w.members.some(m=>m.area===area),'Choose an existing restaurant department.');
    requireThat(manages(me,area,'people.manage'),'Station definitions require people-management permission for this department.',403);
    const title=text(input.title,'Station name',100);
    requireThat(!existing||title===existing.data.title,'Create a separate station to change its name. Existing clearances and history keep their original station.');
    requireThat(!w.records.some(r=>r.kind==='station'&&r.locationId===w.location.id&&r.area===area&&r.id!==existing?.id&&r.data.title.toLowerCase()===title.toLowerCase()),'This station already exists. Edit or restore it instead.');
    requireThat(Array.isArray(input.levels)&&(input.levels.length===0||input.levels.length>=2&&input.levels.length<=10),'Leave levels empty or define 2–10 ordered proficiency levels.');
    const levels=input.levels.map((raw,index)=>{const level=object(raw);return {value:index+1,label:text(level.label,'Level label',80),definition:text(level.definition??'','Level definition',500,true)}});
    requireThat(new Set(levels.map(l=>l.label.toLowerCase())).size===levels.length,'Use distinct level labels.');
    const independentLevel=input.independentLevel??null;
    requireThat(independentLevel===null||Number.isInteger(independentLevel)&&levels.some(l=>l.value===independentLevel),'Choose an independent-readiness threshold from this station scale.');
    requireThat(independentLevel===null||levels.some(l=>l.value===independentLevel&&l.definition),'Define what independent readiness means before setting its threshold.');
    requireThat(input.status==='active'||input.status==='archived','Choose an active or archived station status.');
    const note=text(input.note,'Reason for the station definition',2000);
    const setup=input.setup===undefined?existing?.data.setup:readStationSetup(w,area,input.setup);
    const rubricChanged=existing&&(JSON.stringify(levels)!==JSON.stringify(existing.data.levels)||independentLevel!==existing.data.independentLevel||input.status!==existing.data.status);
    const definitionRevision=existing?(rubricChanged?existing.revision+1:existing.data.definitionRevision??existing.revision):1;
    const data={title,levels,independentLevel:independentLevel as number|null,definitionRevision,...(setup?{setup}:{}),...(existing?.data.issuedGoals?{issuedGoals:existing.data.issuedGoals}:{}),status:input.status as 'active'|'archived',history:[...(existing?.data.history??[]),history(existing?'station-updated':'station-defined',note)]};
    if(existing)save({...existing,data});else create({kind:'station',data},{...me,area});
    return;
  }
  if(command.action==='proficiency.save') {
    const existing=command.recordId?find('proficiency'):undefined,owner=member(input.personId);
    permitted(owner,'people.manage');
    requireThat(owner.id!==me.id,'A different authorized manager must record your proficiency and trainer designation.',403);
    const station=w.records.find((r):r is RecordOf<'station'>=>r.kind==='station'&&r.id===input.stationId&&r.locationId===w.location.id&&r.area===owner.area&&r.data.status==='active');
    requireThat(station,'Choose an active station in this employee’s department.');
    requireThat(station.revision===input.stationRevision,'The station definition changed. Review its current scale first.',409);
    requireThat(!existing||existing.ownerId===owner.id&&existing.data.stationId===station.id,'An assessment cannot move to another employee or station.');
    requireThat(!w.records.some(r=>r.kind==='proficiency'&&r.ownerId===owner.id&&r.data.stationId===station.id&&r.id!==existing?.id),'A proficiency record already exists. Refresh and update its latest version.',409);
    const level=input.level??null;
    requireThat(level===null||Number.isInteger(level)&&station.data.levels.some(l=>l.value===level),'Choose a level from the current station definition.');
    requireThat(typeof input.certifiedTrainer==='boolean','Explicitly choose whether this employee is a certified trainer.');
    const evidence=text(input.evidence,'Assessment evidence and next learning step',2000);
    const data={title:`${owner.name} · ${station.data.title}`,stationId:station.id,stationRevision:station.data.definitionRevision??station.revision,position:station.data.title,level:level as number|null,certifiedTrainer:input.certifiedTrainer,evidence,assessedAt:at,history:[...(existing?.data.history??[]),history('manager-assessed',`${station.data.title} definition ${station.data.definitionRevision??station.revision}; ${station.data.levels.find(l=>l.value===level)?.label??'Not assessed'}; certified trainer: ${input.certifiedTrainer?'yes':'no'}. ${evidence}`)]};
    if(existing)save({...existing,data});else create({kind:'proficiency',data},owner);
    notify([owner.id],'Station development updated',`${me.name} recorded your ${station.data.title} development. Open Team to review the level, trainer designation and next learning step.`);
    return;
  }
  requireThat(false,'Unknown workforce action.');
}
