import { has, type RecordOf, type StationGuide, type Workspace } from './types';
import { object, requireThat, text } from './validation';
import {canManageClosing} from './closing-access';

// This is reviewed restaurant content. It performs no model call or inference.
export function readStationGuide(value:unknown,allowIncomplete=false):StationGuide|undefined {
  if(value===undefined||value===null)return undefined;
  const v=object(value);
  const lines=(key:string,label:string,max:number)=>{
    const entries=v[key]??[];
    requireThat(Array.isArray(entries)&&entries.length<=max,`${label} must contain at most ${max} entries.`);
    return entries.map(line=>text(line,label,1000));
  };
  const guide={purpose:text(v.purpose??'','Purpose',2000,true),preparation:lines('preparation','Preparation',15),steps:lines('steps','Instruction step',30),troubleshooting:lines('troubleshooting','Troubleshooting',15),escalation:text(v.escalation??'','When to get help',2000,true)};
  if(!guide.purpose&&!guide.preparation.length&&!guide.steps.length&&!guide.troubleshooting.length&&!guide.escalation)return undefined;
  requireThat(allowIncomplete||guide.purpose&&guide.steps.length&&guide.escalation,'A station guide needs its purpose, at least one instruction step and when to get help.');
  return guide;
}

export function approvedStationGuides(w:Workspace):RecordOf<'standard'>[] {
  if(w.me.position==='Dishwasher')return w.records.filter((r):r is RecordOf<'standard'>=>r.kind==='standard'&&r.locationId===w.me.locationId&&r.area===w.me.area&&r.data.status==='approved'&&r.data.position==='Dishwasher').sort((a,b)=>a.data.zone.localeCompare(b.data.zone)||b.data.version-a.data.version);
  return w.records.filter((r):r is RecordOf<'standard'>=>r.kind==='standard'&&r.locationId===w.me.locationId&&r.data.status==='approved'&&(r.area===w.me.area||has(w.me,'location.manage')||canManageClosing(w.me,r.area,'tasks.manage'))).sort((a,b)=>a.data.position.localeCompare(b.data.position)||a.data.zone.localeCompare(b.data.zone)||b.data.version-a.data.version);
}

export function assignedStandardCurrent(w:Workspace,close:RecordOf<'close'>):boolean {
  return w.records.some(r=>r.kind==='standard'&&r.locationId===close.locationId&&r.id===close.data.standardId&&r.revision===close.data.standardRevision&&r.data.status==='approved');
}
