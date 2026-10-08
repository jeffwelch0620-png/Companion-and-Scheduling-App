import {requireThat} from './validation';
// Filed equipment keeps its physical identity. Compare with the same Unicode
// case folding as the active register, without loading full history records.
export async function checkFiledEquipmentTag(db:Pick<D1Database,'prepare'>,locationId:string,assetTag:string){
 let after='';
 for(;;){
  const page=(await db.prepare("SELECT id,json_extract(data,'$.assetTag') AS tag FROM records WHERE location_id=? AND kind='equipment' AND archived_at IS NOT NULL AND id>? ORDER BY id LIMIT 100").bind(locationId,after).all<{id:string;tag:string}>()).results;
  requireThat(page.every(r=>typeof r.tag==='string'),'Filed equipment identity needs review.',503);
  requireThat(!page.some(r=>r.tag.toLowerCase()===assetTag.toLowerCase()),'This restaurant asset tag is retained in Work history. Restore the original equipment entry; a replacement needs a different tag.',409);
  if(page.length<100)return;after=page.at(-1)!.id;
 }
}
