import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCommissaryReceipt,saveCommissaryReceipt} from '../.sites-runtime/shared/food-commissary-receipt.mjs';
const context={actorId:'manager',canReceive:true,receivingLocationId:'berts',sourceLocationId:'commissary',owningRestaurantId:'berts',product:{id:'ranch',revision:3,unit:'gal'},sourceRevision:4,destinationRevision:6};
const input=()=>({requestId:'request-1',sourceLocationId:'commissary',destinationLocationId:'berts',owningRestaurantId:'berts',productId:'ranch',productRevision:3,sourceRevision:4,destinationRevision:6,quantity:5,unit:'gal',receivedAt:'2026-10-02T10:00:00Z',confirmed:true});
const at='2026-10-02T11:00:00Z';
// Isolated synthetic transaction harness. Copy-on-commit proves rollback/retry
// behavior of this save path, not a deployed D1/Supabase adapter or stock ledger.
function store(failAt=''){
  let state={revisions:{commissary:4,berts:6},receipts:[],history:[],requests:{}};let tail=Promise.resolve();
  return {get state(){return state;},transaction(work){const run=tail.then(async()=>{
    const next=structuredClone(state),key=(d,a,r)=>`${d}:${a}:${r}`;
    const result=await work({request:async(d,a,r)=>next.requests[key(d,a,r)]??null,locationRevision:async l=>next.revisions[l],
      addReceipt:async r=>{assert.ok(!next.receipts.some(s=>s.id===r.id));next.receipts.push(r);},addHistory:async e=>{if(failAt==='history')throw Error('failure');next.history.push(e);},
      advanceRevision:async(l,expected)=>{assert.equal(next.revisions[l],expected);next.revisions[l]++;},rememberRequest:async(d,a,r,f,result)=>{if(failAt==='request')throw Error('failure');next.requests[key(d,a,r)]={fingerprint:f,result};}});
    state=next;return result;
  });tail=run.catch(()=>{});return run;}};
}
test('receipt starts without dispatch and preserves owner separately from physical locations',()=>{
  const r=prepareCommissaryReceipt({...input(),dispatch:'untrusted'},context,at,'receipt');assert.equal(r.owningRestaurantId,'berts');assert.equal(r.sourceLocationId,'commissary');assert.equal(r.quantity,5);assert.equal('dispatch' in r,false);assert.equal(r.stockPosting,'not-connected');
});
test('one save records receipt/history and both revisions; retry returns original without duplication',async()=>{
  const db=store(),one=await saveCommissaryReceipt(db,input(),context,at,'first'),two=await saveCommissaryReceipt(db,input(),context,'2026-10-02T12:00:00Z','second');
  assert.deepEqual(two,one);assert.equal(db.state.receipts.length,1);assert.equal(db.state.history.length,1);assert.deepEqual(db.state.revisions,{commissary:5,berts:7});
  await assert.rejects(()=>saveCommissaryReceipt(db,{...input(),quantity:4},context,at,'third'));assert.equal(db.state.receipts.length,1);
});
test('transaction failures leave receipts, history, revisions and retry records unchanged',async()=>{
  for(const failAt of ['history','request']){const db=store(failAt),before=structuredClone(db.state);await assert.rejects(()=>saveCommissaryReceipt(db,input(),context,at,'receipt'));assert.deepEqual(db.state,before);}
});
test('stale concurrent saves cannot both commit',async()=>{
  const db=store();const results=await Promise.allSettled([saveCommissaryReceipt(db,input(),context,at,'first'),saveCommissaryReceipt(db,{...input(),requestId:'other-request'},context,at,'second')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(db.state.receipts.length,1);assert.equal(db.state.history.length,1);
});
test('scope, authority, explicit quantity, unit and current source versions are mandatory',()=>{
  for(const patch of [{quantity:0},{quantity:null},{quantity:''},{quantity:-1},{unit:'case'},{sourceLocationId:'other'},{owningRestaurantId:'rudds'},{productRevision:2},{sourceRevision:3},{confirmed:false},{receivedAt:'2026-10-03T00:00:00Z'}])assert.throws(()=>prepareCommissaryReceipt({...input(),...patch},context,at,'receipt'));
  assert.throws(()=>prepareCommissaryReceipt(input(),{...context,canReceive:false},at,'receipt'));
});
