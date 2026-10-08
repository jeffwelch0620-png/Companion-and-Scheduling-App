import type {ComplianceFacts} from './compliance';
import {requireThat} from './validation';

// Filing does not release a source document's identity or its renewal link.
// Match JavaScript case folding used by the active register, across every page.
export async function checkFiledComplianceSource(db:Pick<D1Database,'prepare'>,locationId:string,facts:ComplianceFacts){
 let after='';
 for(;;){
  const rows=(await db.prepare("SELECT id,json_extract(data,'$.type') AS type,json_extract(data,'$.authority') AS authority,json_extract(data,'$.reference') AS reference,json_extract(data,'$.documentDate') AS documentDate FROM records WHERE location_id=? AND kind='compliance' AND archived_at IS NOT NULL AND id>? ORDER BY id LIMIT 100").bind(locationId,after).all<{id:string;type:string;authority:string;reference:string;documentDate:string}>()).results;
  requireThat(rows.every(r=>[r.type,r.authority,r.reference,r.documentDate].every(v=>typeof v==='string')),'Filed safety source identity needs review.',503);
  requireThat(!rows.some(r=>r.type===facts.type&&r.authority.toLowerCase()===facts.authority.toLowerCase()&&r.reference.toLowerCase()===facts.reference.toLowerCase()&&r.documentDate===facts.documentDate),'This source document is retained in Work history. Restore its original record to correct or reopen the follow-up.',409);
  if(rows.length<100)return;after=rows.at(-1)!.id;
 }
}

export async function checkFiledComplianceSuccessor(db:Pick<D1Database,'prepare'>,locationId:string,previousId:string){
 const existing=await db.prepare("SELECT id FROM records WHERE location_id=? AND kind='compliance' AND archived_at IS NOT NULL AND json_extract(data,'$.renewal.previousId')=? LIMIT 1").bind(locationId,previousId).first();
 requireThat(!existing,'This earlier permit already has a newer permit in Work history. Restore that newer record to review or clear its renewal link.',409);
}
