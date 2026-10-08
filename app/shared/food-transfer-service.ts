import {authenticateWorkspace,boundedJson} from './service';
import {context as foodContext} from './food-service';
import {restaurantAccessWriteGuard,requireRestaurantAccess} from './restaurant-access';
const context=(db:Parameters<typeof foodContext>[0],identity:Parameters<typeof foodContext>[1],locationId:string)=>foodContext(db,identity,locationId,true);
import type {WorkspaceIdentity} from './employee-session';
import {AppError,id,object,requireThat,text} from './validation';
import {has,type Command} from './types';
import type {FoodItem} from './food-model';
import {transferDispatch,transferReceipt,type FoodTransfer,type TransferPage,type TransferDetail,type TransferEvent} from './food-transfer';
import {transferQueueQuery,type TransferTotals} from './food-transfer-queue';
import {matchDestinationItem,destinationPackRatio} from './food-transfer-match';
import {changeParcel,parcelActions,parcelTotals,type TransferParcel} from './food-transfer-parcels';

import {readTransferManifest,type TransferManifest} from './food-transfer-manifest';

type DB=Pick<D1Database,'prepare'|'batch'>;
type Row={id:string;sequence:number;source_id:string;destination_id:string;dataset:'demo'|'operating';revision:number;status:FoodTransfer['status'];data:string;reference_key:string};
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff'}});
const dataset=(v:unknown)=>{requireThat(v==='demo'||v==='operating','Choose a food dataset.');return v;};
const unpack=(r:Row):FoodTransfer=>({...JSON.parse(r.data),id:r.id,sequence:r.sequence,sourceId:r.source_id,destinationId:r.destination_id,dataset:r.dataset,revision:r.revision,status:r.status});
async function getRow(db:DB,location:string,record:string,ds:string,allowedLocationIds?:readonly string[]){const row=await db.prepare('SELECT * FROM food_transfers WHERE id=? AND dataset=? AND (source_id=? OR destination_id=?)').bind(record,ds,location,location).first<Row>();requireThat(row,'Transfer not found for this restaurant and dataset.',404);requireThat(!allowedLocationIds||allowedLocationIds.includes(row.source_id)&&allowedLocationIds.includes(row.destination_id),'This transfer is outside your commissary restaurant scope.',403);return row;}
async function prior(db:DB,loc:string,actor:string,request:string,fingerprint:string){
 const row=await db.prepare('SELECT fingerprint,result FROM food_receipts WHERE location_id=? AND actor_id=? AND request_id=?').bind(loc,actor,request).first<{fingerprint:string;result:string}>();
 if(!row)return null;requireThat(row.fingerprint===fingerprint,'This request identifier was already used for another change.',409);return JSON.parse(row.result);
}
async function read(db:DB,identity:WorkspaceIdentity,url:URL){
 const loc=id(url.searchParams.get('locationId')),ds=dataset(url.searchParams.get('dataset')??'operating'),ctx=await context(db,identity,loc);
 const allowedLocationIds=ctx.restaurantAccess.kind==='commissary'?['comm','berts','rudds']:undefined;
 let result:TransferPage|TransferDetail|TransferManifest;
 if(url.searchParams.has('manifest')){
  requireThat(url.searchParams.get('manifest')==='1','Choose a valid manifest request.');
  result=await readTransferManifest(db,url,ctx.w.location,ds,ctx.revision,allowedLocationIds);
 }else if(url.searchParams.has('recordId')){
  const r=await getRow(db,loc,id(url.searchParams.get('recordId')),ds,allowedLocationIds),after=Number(url.searchParams.get('after')??0);
  requireThat(Number.isSafeInteger(after)&&after>=0,'Invalid transfer history cursor.');
  if(after)requireThat(Number(url.searchParams.get('revision'))===r.revision,'Transfer changed. Reopen its history.',409);
  const events=await db.prepare('SELECT event FROM food_transfer_events WHERE transfer_id=? AND revision>? ORDER BY revision LIMIT 21').bind(r.id,after).all<{event:string}>();
  const list=events.results.slice(0,20).map(e=>JSON.parse(e.event) as TransferEvent),transfer=unpack(r);
  let destinationMatchReview:TransferDetail['destinationMatchReview']='unmatched';
  if(transfer.destinationMatch){
   const item=await db.prepare("SELECT revision,data FROM food_records WHERE id=? AND location_id=? AND dataset=? AND kind='fooditem'").bind(transfer.destinationMatch.item.id,transfer.destinationId,ds).first<{revision:number;data:string}>();
   const data=item?JSON.parse(item.data) as FoodItem:null;
   destinationMatchReview=!item?'unavailable':item.revision!==transfer.destinationMatch.item.revision||!data?.active||!data.countActive||data.needsReview?'changed':'current';
  }
  result={transfer,events:list,next:events.results.length>20?list.at(-1)!.revision:null,destinationMatchReview};
 }else{
  const {query,before,sql,condition,args,window}=transferQueueQuery(url,loc,ds,ctx.revision,ctx.w.location.timezone,allowedLocationIds);
  const routeScope=allowedLocationIds?` AND r.destination_id IN (${allowedLocationIds.map(()=>'?').join(',')})`:'';
  const rows=await db.batch([
   db.prepare(sql+`SELECT * FROM scoped WHERE ${condition} AND (?=0 OR sequence<?) ORDER BY sequence DESC LIMIT 21`).bind(...args,before,before),
   db.prepare('SELECT l.id,l.name FROM food_transfer_routes r JOIN locations l ON l.id=r.destination_id WHERE r.source_id=? AND r.dataset=? AND r.active=1 AND r.destination_id<>r.source_id'+routeScope+' ORDER BY l.name LIMIT 100').bind(loc,ds,...(allowedLocationIds??[])),
   db.prepare(sql+`SELECT count(*) AS total FROM scoped WHERE ${condition}`).bind(...args),
   db.prepare(sql+`SELECT coalesce(sum(status='sent'),0) AS open,coalesce(sum(status='received'),0) AS final,coalesce(sum(difference),0) AS differences,coalesce(sum(status='voided'),0) AS voided FROM scoped`).bind(...args)
  ]);
  const entries=(rows[0].results as Row[]).slice(0,20).map(row=>{const transfer=unpack(row);if(!transfer.parcels?.length)return transfer;const {parcels,...summary}=transfer;return {...summary,parcelTotals:parcelTotals(transfer)};});result={revision:ctx.revision,entries,next:rows[0].results.length>20?entries.at(-1)!.sequence:null,routes:rows[1].results as {id:string;name:string}[],query,window,total:(rows[2].results[0] as {total:number}).total,totals:rows[3].results[0] as TransferTotals};
 }
 const check=await context(db,identity,loc);requireThat(check.revision===ctx.revision&&check.membershipRevision===ctx.membershipRevision&&check.restaurantAccess.kind===ctx.restaurantAccess.kind&&check.restaurantAccess.home_location_id===ctx.restaurantAccess.home_location_id&&check.restaurantAccess.revision===ctx.restaurantAccess.revision,'Food records or access changed while loading. Refresh.',409);return result;
}
async function write(db:DB,identity:WorkspaceIdentity,c:Command){
 requireThat(['transfer.dispatch','transfer.receive','transfer.check-progress','transfer.correct-receipt','transfer.void','transfer.match-item','transfer.clear-item-match',...parcelActions].includes(c.action),'Unsupported transfer action.');
 const ctx=await context(db,identity,c.locationId),w=ctx.w,ds=dataset(c.input.dataset),at=new Date().toISOString();
 const policy=await restaurantAccessWriteGuard(db,identity,c.locationId,'commissary-food');
 const currentAccess=await requireRestaurantAccess(db,identity,c.locationId,'commissary-food');
 requireThat(currentAccess.kind===ctx.restaurantAccess.kind&&currentAccess.home_location_id===ctx.restaurantAccess.home_location_id&&currentAccess.revision===ctx.restaurantAccess.revision,'Restaurant access changed while preparing this transfer. Refresh.',409);
 const allowedLocationIds=ctx.restaurantAccess.kind==='commissary'?['comm','berts','rudds']:undefined;
 // Check both transfer endpoints before replaying a previously accepted save.
 // A configured transport route cannot widen a commissary account's scope.
 if(allowedLocationIds){
  if(c.action==='transfer.dispatch')requireThat(allowedLocationIds.includes(id(c.input.destinationId)),'This destination is outside your commissary restaurant scope.',403);
  else if(c.recordId)await getRow(db,w.location.id,c.recordId,ds,allowedLocationIds);
 }
 const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(c)))),v=>v.toString(16).padStart(2,'0')).join('');
 const repeated=await prior(db,w.location.id,w.me.id,c.requestId,fingerprint);if(repeated)return repeated;
 let transfer:FoodTransfer,referenceKey='',condition='',conditionArgs:(string|number)[]=[],event:TransferEvent;
 if(c.action==='transfer.dispatch'){
  requireThat(!c.recordId,'Dispatch creates a new transfer.');
  const target=id(c.input.destinationId),itemId=id(c.input.itemId);requireThat(target!==w.location.id,'Choose a different destination restaurant.');
  const route=await db.prepare('SELECT l.name FROM food_transfer_routes r JOIN locations l ON l.id=r.destination_id WHERE r.source_id=? AND r.destination_id=? AND r.dataset=? AND r.active=1').bind(w.location.id,target,ds).first<{name:string}>();requireThat(route,'This restaurant route has not been configured for transfers.',403);
  const item=await db.prepare("SELECT revision,data FROM food_records WHERE id=? AND location_id=? AND dataset=? AND kind='fooditem'").bind(itemId,w.location.id,ds).first<{revision:number;data:string}>();requireThat(item,'Source item not found in this restaurant and dataset.',404);
  requireThat(c.input.itemRevision===item.revision,'The source item changed. Refresh before dispatching.',409);
  const dispatch=transferDispatch(c.input,JSON.parse(item.data) as FoodItem,itemId,item.revision,at,w.me.id,w.me.name);
  referenceKey=JSON.stringify([itemId,dispatch.reference.toLowerCase().replace(/\s+/g,' ')]);
  requireThat(!await db.prepare("SELECT id FROM food_transfers WHERE source_id=? AND dataset=? AND reference_key=? AND status<>'voided' LIMIT 1").bind(w.location.id,ds,referenceKey).first(),'This item and transfer reference are already recorded. Review the original transfer.',409);
  transfer={id:crypto.randomUUID(),sequence:0,revision:1,sourceId:w.location.id,destinationId:target,sourceName:w.location.name,destinationName:route.name,dataset:ds,status:'sent',dispatch,receipt:null};
  condition="EXISTS(SELECT 1 FROM food_records WHERE id=? AND location_id=? AND revision=?) AND EXISTS(SELECT 1 FROM food_transfer_routes WHERE source_id=? AND destination_id=? AND dataset=? AND active=1) AND NOT EXISTS(SELECT 1 FROM food_transfers WHERE source_id=? AND dataset=? AND reference_key=? AND status<>'voided')";
  conditionArgs=[itemId,w.location.id,item.revision,w.location.id,target,ds,w.location.id,ds,referenceKey];
  event={revision:1,action:'sent',at,by:w.me.id,byName:w.me.name,reason:dispatch.note};
 }else{
  requireThat(c.recordId,'Open the transfer first.');const row=await getRow(db,w.location.id,c.recordId,ds,allowedLocationIds);transfer=unpack(row);referenceKey=row.reference_key;
  requireThat(c.expectedRevision===row.revision,'Transfer changed. Refresh before saving.',409);requireThat(transfer.status!=='voided','This transfer was voided.',409);
  const reviewer=has(w.me,'location.manage')||has(w.me,'orders.review');let reason='';
  const matching=c.action==='transfer.match-item'||c.action==='transfer.clear-item-match',parcelAction=parcelActions.includes(c.action);
  let parcel:TransferParcel|undefined;
  let itemGuard='',itemGuardArgs:(string|number)[]=[];
  if(parcelAction){
   const changed=changeParcel(transfer,c.action,c.input,w.location.id,w.me.id,w.me.name,reviewer,at);
   transfer.parcels=changed.parcels;parcel=changed.parcel;reason=changed.reason;
  }else if(matching){
   requireThat(w.location.id===transfer.destinationId,'Only the destination restaurant can match its catalog item.',403);
   requireThat(reviewer,'Destination item matching requires purchasing review access.',403);
   reason=text(c.input.reason,'Item-match evidence or correction reason',1000);
   if(c.action==='transfer.clear-item-match'){
    requireThat(transfer.destinationMatch,'This transfer has no destination item match to clear.',409);
    transfer.destinationMatch=null;
   }else{
    const itemId=id(c.input.itemId);
    const item=await db.prepare("SELECT revision,data FROM food_records WHERE id=? AND location_id=? AND dataset=? AND kind='fooditem'").bind(itemId,w.location.id,ds).first<{revision:number;data:string}>();
    requireThat(item,'Destination item not found in this restaurant and dataset.',404);
    requireThat(c.input.itemRevision===item.revision,'The destination item changed. Search again before matching.',409);
    requireThat(transfer.destinationMatch?.item.id!==itemId||transfer.destinationMatch.item.revision!==item.revision,'This destination item revision is already matched.',409);
    transfer.destinationMatch=matchDestinationItem(c.input,transfer.dispatch,JSON.parse(item.data),itemId,item.revision,at,w.me.id,w.me.name);
    itemGuard=" AND EXISTS(SELECT 1 FROM food_records WHERE id=? AND location_id=? AND dataset=? AND kind='fooditem' AND revision=?)";
    itemGuardArgs=[itemId,w.location.id,ds,item.revision];
   }
  }else if(c.action==='transfer.void'){
   requireThat(w.location.id===transfer.sourceId,'Only the dispatch restaurant can void its incorrect record.',403);
   requireThat(w.me.id===transfer.dispatch.by||reviewer,'Only the recorder or purchasing reviewer can void this dispatch.',403);
   requireThat(transfer.status==='sent'&&!transfer.receipt,'The destination already checked this transfer. Its receipt must remain linked; review differences instead of voiding the dispatch.',409);
   requireThat(!(transfer.parcels??[]).some(p=>!p.void),'Resolve active parcel records before voiding an incorrect dispatch.',409);
   reason=text(c.input.reason,'Reason for voiding incorrect dispatch',1000);transfer.status='voided';
  }else{
   requireThat(w.location.id===transfer.destinationId,'Only the destination restaurant can confirm its delivery.',403);
   if(c.action==='transfer.receive')requireThat(!transfer.receipt,'This transfer already has a check. Update an open check or use receipt correction.',409);
   else if(c.action==='transfer.check-progress')requireThat(transfer.receipt?.complete===false&&transfer.status==='sent','Only an open delivery check can record more arrivals. Correct a final check before reopening it.',409);
   else{requireThat(transfer.receipt,'Record the first receipt before correcting it.',409);requireThat(w.me.id===transfer.receipt.by||reviewer,'Only the receipt recorder or purchasing reviewer can correct it.',403);reason=text(c.input.correctionReason,'Correction reason',1000);}
   if(c.input.quantityBasis==='destination'){
    const match=transfer.destinationMatch;requireThat(match,'Review the destination item match before using its units.',409);
    const item=await db.prepare("SELECT revision,data FROM food_records WHERE id=? AND location_id=? AND dataset=? AND kind='fooditem'").bind(match.item.id,w.location.id,ds).first<{revision:number;data:string}>();
    requireThat(item&&item.revision===match.item.revision,'Destination catalog changed. Recheck its item match or use original dispatch units.',409);
    requireThat(destinationPackRatio(transfer.dispatch,JSON.parse(item.data))===match.destinationUnitsPerDispatchUnit,'Destination pack changed. Recheck the item match.',409);
    itemGuard=" AND EXISTS(SELECT 1 FROM food_records WHERE id=? AND location_id=? AND dataset=? AND kind='fooditem' AND revision=?)";
    itemGuardArgs=[match.item.id,w.location.id,ds,item.revision];
   }
   const receipt=transferReceipt(c.input,transfer.dispatch,at,w.me.id,w.me.name,transfer.destinationMatch);
   if(c.action==='transfer.check-progress'){
    const previous=transfer.receipt!;
    requireThat(receipt.accepted>=previous.accepted&&receipt.rejected>=previous.rejected,'Additional arrivals cannot reduce earlier accepted or rejected totals. Use a reasoned receipt correction.',409);
    requireThat(receipt.receivedAt>=previous.receivedAt,'The next delivery check cannot precede the previous check.');
    requireThat(receipt.complete!==false||receipt.accepted+receipt.rejected>previous.accepted+previous.rejected,'Record additional arrived goods or finish the check; these totals have not changed.');
   }
   transfer.receipt=receipt;transfer.status=receipt.complete===false?'sent':'received';
  }
  transfer.revision++;
  event={revision:transfer.revision,action:parcelAction?(c.action==='transfer.parcel-depart'?'parcel-departed':c.action==='transfer.parcel-arrive'?'parcel-arrived':c.action==='transfer.parcel-reopen'?'parcel-reopened':'parcel-voided'):matching?(c.action==='transfer.match-item'?'item-matched':'item-match-cleared'):c.action==='transfer.void'?'voided':c.action==='transfer.correct-receipt'?'receipt-corrected':transfer.receipt?.complete===false?'receipt-progress':'received',at,by:w.me.id,byName:w.me.name,reason,...(parcelAction?{parcel}:matching?{destinationMatch:transfer.destinationMatch??null}:transfer.receipt?{receipt:transfer.receipt}:{})};
  condition='EXISTS(SELECT 1 FROM food_transfers WHERE id=? AND revision=?)'+itemGuard;conditionArgs=[transfer.id,row.revision,...itemGuardArgs];
 }
 const data=JSON.stringify(transfer);requireThat(new TextEncoder().encode(data).byteLength<=256000,'Transfer record is too large. Shorten notes before saving.',413);
 const token=crypto.randomUUID(),loc=w.location.id,other=transfer.sourceId===loc?transfer.destinationId:transfer.sourceId,gate='EXISTS(SELECT 1 FROM food_state WHERE location_id=? AND last_command=?)',result={recordId:transfer.id,revision:transfer.revision};
 const statements=[
  db.prepare(`INSERT INTO food_state(location_id) SELECT ? WHERE ${policy.sql} ON CONFLICT(location_id) DO NOTHING`).bind(loc,...policy.values),
  db.prepare(`INSERT INTO food_state(location_id) SELECT ? WHERE ${policy.sql} ON CONFLICT(location_id) DO NOTHING`).bind(other,...policy.values),
  db.prepare(`UPDATE food_state SET revision=revision+1,last_command=? WHERE location_id=? AND revision=? AND EXISTS(SELECT 1 FROM memberships WHERE id=? AND location_id=? AND auth_user_id=? AND active=1 AND revision=?) AND ${policy.sql} AND ${condition}`).bind(token,loc,ctx.revision,w.me.id,loc,identity.authUserId,ctx.membershipRevision,...policy.values,...conditionArgs),
  db.prepare(`INSERT INTO food_transfers(id,source_id,destination_id,dataset,reference_key,revision,status,data,updated_at) SELECT ?,?,?,?,?,?,?,?,? WHERE ${gate} ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,status=excluded.status,data=excluded.data,updated_at=excluded.updated_at`).bind(transfer.id,transfer.sourceId,transfer.destinationId,ds,referenceKey,transfer.revision,transfer.status,JSON.stringify(transfer),at,loc,token),
  db.prepare(`INSERT INTO food_transfer_events(transfer_id,revision,event) SELECT ?,?,? WHERE ${gate}`).bind(transfer.id,transfer.revision,JSON.stringify(event),loc,token),
  db.prepare(`UPDATE food_state SET revision=revision+1 WHERE location_id=? AND ${gate}`).bind(other,loc,token),
  db.prepare(`INSERT INTO food_receipts(location_id,actor_id,request_id,fingerprint,result) SELECT ?,?,?,?,? WHERE ${gate}`).bind(loc,w.me.id,c.requestId,fingerprint,JSON.stringify(result),loc,token),
  db.prepare(`INSERT INTO audit_events(id,location_id,actor_id,action,record_id,at,revision) SELECT ?,?,?,?,?,?,? WHERE ${gate}`).bind(token,loc,w.me.id,c.action,transfer.id,at,transfer.revision,loc,token)
 ];
 const saved=await db.batch(statements);if(!saved[2].meta.changes){await requireRestaurantAccess(db,identity,loc,'commissary-food');const retry=await prior(db,loc,w.me.id,c.requestId,fingerprint);if(retry)return retry;throw new AppError(409,'Transfer, route, item or access changed. Refresh before saving.');}return result;
}
export async function handleFoodTransfers(request:Request,binding?:D1Database):Promise<Response>{
 try{
  requireThat(['GET','POST'].includes(request.method),'Method not allowed.',405);
  const {db,identity}=await authenticateWorkspace(request,binding),url=new URL(request.url);
  if(request.method==='GET')return json(await read(db,identity,url));
  requireThat(request.headers.get('Origin')===url.origin&&request.headers.get('Sec-Fetch-Site')!=='cross-site','Open this action from your JMAX workspace.',403);
  requireThat(request.headers.get('Content-Type')?.split(';')[0]==='application/json','Use a JSON request.',415);
  const body=object(await boundedJson(request.body,16000)),c:Command={requestId:id(body.requestId),locationId:id(body.locationId),action:text(body.action,'Action',60),input:object(body.input)};
  if(body.recordId!==undefined){c.recordId=id(body.recordId);requireThat(Number.isSafeInteger(body.expectedRevision)&&Number(body.expectedRevision)>0,'An exact transfer revision is required.');c.expectedRevision=Number(body.expectedRevision);}
  return json(await write(db,identity,c));
 }catch(e){if(e instanceof AppError)return json({error:e.message},e.status);console.error(JSON.stringify({event:'food_transfer_failed',errorType:e instanceof Error?e.name:'unknown'}));return json({error:'Transfer save could not be confirmed. Retrying the same request is safe.'},503);}
}
