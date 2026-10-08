import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {postDraftCommissaryReceipt,correctDraftCommissaryReceipt} from '../.sites-runtime/shared/food-commissary-ledger-prototype.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
const at='2026-10-02T12:00:00Z';
const context={actorId:'fixture-manager',canReceive:true,receivingLocationId:'fixture-destination',sourceLocationId:'fixture-storage',owningRestaurantId:'fixture-owner',product:{id:'fixture-product',revision:3,unit:'gal'},sourceRevision:4,destinationRevision:6};
const mapping={id:'fixture-approved-map',revision:1,batchId:'fixture-batch',batchRevision:2,consumingRestaurantId:'fixture-consumer',productionLocationId:'fixture-production'};
const input=(requestId='fixture-request')=>({requestId,sourceLocationId:context.sourceLocationId,destinationLocationId:context.receivingLocationId,owningRestaurantId:context.owningRestaurantId,productId:context.product.id,productRevision:3,sourceRevision:4,destinationRevision:6,quantity:5,unit:'gal',receivedAt:'2026-10-02T11:00:00Z',confirmed:true});
async function fixture(t){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 // Existing migrations plus isolated draft prove coexistence; draft never added
 // to normal migration directory or applied to a hosted database.
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 await db.batch(fs.readFileSync('drafts/commissary-receipt-ledger.sql','utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 await db.batch([
 db.prepare('INSERT INTO draft_food_batches VALUES(?,?,?,?,?,?,?)').bind(mapping.batchId,context.product.id,3,context.owningRestaurantId,mapping.productionLocationId,'gal',2),
 db.prepare('INSERT INTO draft_food_receipt_mappings VALUES(?,?,?,?,?,?,?)').bind(mapping.id,1,1,mapping.batchId,mapping.consumingRestaurantId,context.sourceLocationId,context.receivingLocationId),
 db.prepare('INSERT INTO draft_food_balances VALUES(?,?,?,?)').bind(mapping.batchId,context.sourceLocationId,12,4),
 db.prepare('INSERT INTO draft_food_balances VALUES(?,?,?,?)').bind(mapping.batchId,context.receivingLocationId,2,6)]);
 const snapshot=async()=>Object.fromEntries(await Promise.all(['balances','receipts','movements','receipt_guards','receipt_heads','corrections','correction_movements'].map(async n=>[n,(await db.prepare(`SELECT * FROM draft_food_${n} ORDER BY 1,2`).all()).results])));
 return {db,snapshot,post:(body=input(),ctx=context,map=mapping,id='fixture-receipt')=>postDraftCommissaryReceipt(db,body,ctx,map,at,id)};
}
test('atomic receipt-only paired ledger preserves distinct owner, consumer, production and storage; retries once',async t=>{
 const f=await fixture(t),one=await f.post(),two=await f.post(input(),context,mapping,'generated-second');assert.deepEqual(two,one);
 const s=await f.snapshot();assert.deepEqual(s.balances.map(b=>[b.location_id,b.quantity,b.revision]),[['fixture-destination',7,7],['fixture-storage',7,5]]);
 assert.equal(s.receipts.length,1);assert.equal(s.movements.length,2);assert.equal(s.movements.reduce((n,m)=>n+m.quantity_delta,0),0);assert.equal(s.receipt_guards.length,0);
 assert.equal(one.receipt.owningRestaurantId,'fixture-owner');assert.equal(one.mapping.consumingRestaurantId,'fixture-consumer');assert.equal(one.mapping.productionLocationId,'fixture-production');assert.equal('dispatch' in one.receipt,false);
 await assert.rejects(()=>f.post({...input(),quantity:4},context,mapping,'third'));assert.deepEqual(await f.snapshot(),s);
});

const correction=(quantity=3,revision=1,requestId='correction-request')=>({receiptId:'fixture-receipt',requestId,expectedReceiptRevision:revision,correctedQuantity:quantity,reason:'Corrected measured quantity',confirmed:true});
const correctionContext=(sourceRevision=5,destinationRevision=7)=>({...context,canCorrect:true,sourceRevision,destinationRevision});
const correct=(f,body=correction(),ctx=correctionContext(),id='correction-1')=>correctDraftCommissaryReceipt(f.db,body,ctx,'2026-10-02T13:00:00Z',id);
test('append-only quantity correction and zero reversal post only deltas and preserve originals',async t=>{
 const f=await fixture(t);await f.post();const original=(await f.snapshot()).receipts;
 const first=await correct(f);assert.equal(first.quantityDelta,-2);assert.equal(first.kind,'correction');
 const replay=await correct(f,correction(),correctionContext(),'generated-retry');assert.deepEqual(replay,first);
 const second=await correct(f,correction(0,2,'reverse'),correctionContext(6,8),'reversal');assert.equal(second.quantityDelta,-3);assert.equal(second.kind,'reversal');
 const s=await f.snapshot();assert.deepEqual(s.receipts,original);assert.deepEqual(s.balances.map(b=>[b.quantity,b.revision]),[[2,9],[12,7]]);assert.equal(s.correction_movements.reduce((n,m)=>n+m.quantity_delta,0),0);assert.equal(s.corrections.length,2);assert.equal(s.receipt_heads[0].effective_quantity,0);
 await assert.rejects(()=>correct(f,correction(0,2,'double-reverse'),correctionContext(6,8),'duplicate'));assert.deepEqual(await f.snapshot(),s);
 for(const table of ['receipts','movements','corrections','correction_movements']){await assert.rejects(()=>f.db.prepare(`DELETE FROM draft_food_${table}`).run());await assert.rejects(()=>f.db.prepare(`UPDATE draft_food_${table} SET rowid=rowid`).run());assert.deepEqual(await f.snapshot(),s);}
});
test('correction rollback and insufficient reversal/increase leave all posting records unchanged',async t=>{
 const f=await fixture(t);await f.post();let before=await f.snapshot();
 await f.db.prepare("CREATE TRIGGER correction_fail BEFORE INSERT ON draft_food_correction_movements BEGIN SELECT RAISE(ABORT,'synthetic correction failure'); END").run();await assert.rejects(()=>correct(f));assert.deepEqual(await f.snapshot(),before);
 await f.db.prepare('DROP TRIGGER correction_fail').run();await assert.rejects(()=>correct(f,correction(20)));assert.deepEqual(await f.snapshot(),before);
 // Simulate subsequent usage with its revision advanced: enough stock to
 // reverse the original receipt must still physically be at destination.
 await f.db.prepare("UPDATE draft_food_balances SET quantity=1,revision=revision+1 WHERE location_id='fixture-destination'").run();before=await f.snapshot();
 await assert.rejects(()=>correct(f,correction(0),correctionContext(5,8)));assert.deepEqual(await f.snapshot(),before);
});
test('concurrent correction has one revision winner and identical correction retries once',async t=>{
 const f=await fixture(t);await f.post();const r=await Promise.allSettled([correct(f,correction(3,1,'a'),correctionContext(),'a'),correct(f,correction(4,1,'b'),correctionContext(),'b')]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal((await f.snapshot()).corrections.length,1);
 const g=await fixture(t);await g.post();const same=await Promise.all([correct(g,correction(),correctionContext(),'one'),correct(g,correction(),correctionContext(),'two')]);assert.deepEqual(same[0],same[1]);assert.equal((await g.snapshot()).correction_movements.length,2);
 await assert.rejects(()=>correct(g,correction(4),correctionContext(),'different-content'));assert.equal((await g.snapshot()).corrections.length,1);
});
test('corrections require explicit authority, reason, current versions and original scope',async t=>{
 const f=await fixture(t);await f.post();const before=await f.snapshot();
 for(const body of [{...correction(),correctedQuantity:-1},{...correction(),correctedQuantity:5},{...correction(),reason:''},{...correction(),confirmed:false},{...correction(),expectedReceiptRevision:0}]){await assert.rejects(()=>correct(f,body));assert.deepEqual(await f.snapshot(),before);}
 for(const ctx of [{...correctionContext(),canCorrect:false},{...correctionContext(),owningRestaurantId:'wrong'},{...correctionContext(),product:{...context.product,unit:'case'}},{...correctionContext(),sourceRevision:4}]){await assert.rejects(()=>correct(f,correction(),ctx));assert.deepEqual(await f.snapshot(),before);}
});
test('post-debit failure rolls back receipt, balances, ledger and guard',async t=>{
 const f=await fixture(t),before=await f.snapshot();await f.db.prepare("CREATE TRIGGER fixture_failure BEFORE INSERT ON draft_food_movements BEGIN SELECT RAISE(ABORT,'synthetic ledger failure'); END").run();
 await assert.rejects(()=>f.post());assert.deepEqual(await f.snapshot(),before);
});
test('stale concurrent requests have one winner; identical concurrent request returns one receipt',async t=>{
 const f=await fixture(t);const results=await Promise.allSettled([f.post(input('a'),context,mapping,'a'),f.post(input('b'),context,mapping,'b')]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const s=await f.snapshot();assert.equal(s.receipts.length,1);assert.equal(s.movements.length,2);
 // Same committed action still replays with original revision evidence.
 const winning=results.find(r=>r.status==='fulfilled').value;const replay=await f.post(input(winning.receipt.requestId),context,mapping,'new-id');assert.deepEqual(replay,winning);
 const g=await fixture(t),identical=await Promise.all([g.post(input(),context,mapping,'same-a'),g.post(input(),context,mapping,'same-b')]);
 assert.deepEqual(identical[0],identical[1]);assert.equal((await g.snapshot()).receipts.length,1);assert.equal((await g.snapshot()).movements.length,2);
});
test('unapproved mapping, changed batch, insufficient stock or wrong scope fail without changes',async t=>{
 const f=await fixture(t),before=await f.snapshot();
 for(const changed of [{...mapping,batchRevision:1},{...mapping,productionLocationId:'wrong'},{...mapping,consumingRestaurantId:'wrong'},{...mapping,revision:2}]){await assert.rejects(()=>f.post(input(),context,changed));assert.deepEqual(await f.snapshot(),before);}
 await assert.rejects(()=>f.post({...input(),quantity:13}));await assert.rejects(()=>f.post(input(),{...context,canReceive:false}));assert.deepEqual(await f.snapshot(),before);
 await f.db.prepare('UPDATE draft_food_receipt_mappings SET approved=0').run();await assert.rejects(()=>f.post());assert.deepEqual(await f.snapshot(),before);
});
