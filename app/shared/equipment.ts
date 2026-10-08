import {type Member,type RecordOf,type History,type Workspace} from './types';
import type {CommandContext} from './followthrough';
import {contactOwner,contactManager} from './service-contacts';
import {requireThat,text} from './validation';

export type EquipmentFacts={title:string;assetTag:string;placement:string;manufacturer:string;model:string;serial:string;sourceRef:string;details:string};
export type Equipment=EquipmentFacts&{status:'active'|'retired';checkedBy:string;checkedAt:string;retirementNote:string;history:History;versions:{facts:EquipmentFacts;by:string;at:string;reason:string}[]};
export type EquipmentSnapshot={id:string;revision:number;facts:EquipmentFacts;checkedBy:string;checkedAt:string};
export const equipmentOwner=contactOwner,equipmentManager=contactManager;
export function equipmentReader(r:RecordOf<'equipment'>,m:Member){return r.locationId===m.locationId&&equipmentManager(m)&&(r.data.status==='active'||equipmentOwner(m));}
export function equipmentFacts(d:EquipmentFacts):EquipmentFacts{const {title,assetTag,placement,manufacturer,model,serial,sourceRef,details}=d;return {title,assetTag,placement,manufacturer,model,serial,sourceRef,details};}
export function equipmentSnapshot(r:RecordOf<'equipment'>):EquipmentSnapshot{return {id:r.id,revision:r.revision,facts:equipmentFacts(r.data),checkedBy:r.data.checkedBy,checkedAt:r.data.checkedAt};}
export function equipmentLinkState(w:Workspace,link?:EquipmentSnapshot){if(!link)return 'unlinked';const r=w.records.find((r):r is RecordOf<'equipment'>=>r.kind==='equipment'&&r.id===link.id&&r.locationId===w.location.id);return !r?'unavailable':r.data.status!=='active'?'retired':r.revision!==link.revision?'changed':'current';}
export function applyEquipment(c:CommandContext){
 const {w,me,input,command,at,find,create,save,history}=c;
 requireThat(equipmentOwner(me),'A restaurant owner or administrator maintains checked equipment.',403);
 requireThat(['equipment.create','equipment.revise','equipment.retire'].includes(command.action),'Unknown equipment action.');
 const r=command.action==='equipment.create'?null:find('equipment'),note=text(input.note,'Source check or reason',2000);
 if(command.action==='equipment.retire'){
  requireThat(r&&r.data.status==='active','Choose an active asset.');
  save({...r,data:{...r.data,status:'retired',retirementNote:note,history:[...r.data.history,history('retired',note)]}});return;
 }
 requireThat(!r||r.data.versions.length<100,'This asset reached its source revision limit. Retire it and preserve its history.');
 requireThat(input.checked===true,'Confirm that you checked this physical asset against the stated source. A replacement needs its own asset entry.');
 const facts:EquipmentFacts={title:text(input.title,'Equipment name',200),assetTag:text(input.assetTag,'Restaurant asset tag',100),placement:text(input.placement,'Physical location',300),manufacturer:text(input.manufacturer??'','Manufacturer',200,true),model:text(input.model??'','Model',200,true),serial:text(input.serial??'','Serial number',200,true),sourceRef:text(input.sourceRef,'Checked equipment source',2000),details:text(input.details??'','Equipment notes',2000,true)};
 requireThat(!r||facts.assetTag===r.data.assetTag,'Keep this asset tag attached to its history. A different physical asset needs its own entry.');
 requireThat(!w.records.some(x=>x.kind==='equipment'&&x.locationId===me.locationId&&x.id!==r?.id&&x.data.assetTag.toLowerCase()===facts.assetTag.toLowerCase()),'This restaurant asset tag is already retained. Open the original entry, including retired equipment.',409);
 const data:Equipment={...facts,status:'active',checkedBy:me.id,checkedAt:at,retirementNote:'',history:[...(r?.data.history??[]),history(r?'source-rechecked':'created',note)],versions:[...(r?.data.versions??[]),...(r?[{facts:equipmentFacts(r.data),by:me.id,at,reason:note}]:[])]};
 if(r)save({...r,data});else{requireThat(!command.recordId,'Open the existing equipment entry to revise it.');create({kind:'equipment',data});}
}
