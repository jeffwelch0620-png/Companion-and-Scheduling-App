import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {Miniflare} from 'miniflare';
import {handleFoodTransfers} from '../.sites-runtime/shared/food-transfer-service.mjs';
import {transferManifestCsv} from '../.sites-runtime/shared/food-transfer-manifest.mjs';
import {seedManifest,manifestHeaders,parcel,addManifestTransfer} from './transfer-manifest-fixture.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
async function fixture(t){const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');await seedManifest(db);
 const get=async(actor='sender',loc='a',query={},binding=db)=>{const r=await handleFoodTransfers(new Request('https://test.example/api/food/transfers?'+new URLSearchParams({locationId:loc,dataset:'demo',manifest:'1',view:'outgoing',trip:'Trip 1',date:'2026-09-28',...query}),{headers:manifestHeaders(actor)}),binding);return{status:r.status,data:await r.json(),headers:r.headers}};return{db,get};}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
test('manifest groups active parcels across transfers without summing unlike units or changing records',async t=>{
 const f=await fixture(t);await addManifestTransfer(f.db,'one',{parcels:[parcel('p1'),parcel('p2',{arrival:{arrivedAt:'2026-09-28T13:00:00Z'}}),parcel('other-trip',{tripReference:'Trip 2'}),parcel('voided',{void:{reason:'Mistake'}})],receipt:{accepted:3,rejected:1,missing:0,complete:false,receivedAt:'2026-09-28T13:00:00Z',reason:'Private reason',note:'Private receipt note'}});
 const second=await addManifestTransfer(f.db,'two');second.dispatch.item.pack.purchaseUnit='tub';await f.db.prepare('UPDATE food_transfers SET data=? WHERE id=?').bind(JSON.stringify(second),'two').run();
 await addManifestTransfer(f.db,'voided',{status:'voided'});await addManifestTransfer(f.db,'operating',{dataset:'operating'});await addManifestTransfer(f.db,'elsewhere',{sourceId:'c',destinationId:'b'});
 const before=(await f.db.prepare('SELECT * FROM food_transfers ORDER BY id').all()).results,m=ok(await f.get());
 assert.deepEqual(m.counts,{transfers:2,parcels:3,arrived:1,awaiting:2});assert.deepEqual(m.entries.map(e=>e.id),['one','two']);assert.equal(m.entries[0].receipt.accepted,3);assert.equal(m.entries[0].parcels.length,2);assert.equal(m.entries[1].item.pack.purchaseUnit,'tub');assert.equal(m.revision,7);assert.equal(m.complete,true);assert.doesNotMatch(JSON.stringify(m),/Private/);
 assert.deepEqual((await f.db.prepare('SELECT * FROM food_transfers ORDER BY id').all()).results,before);assert.equal((await f.db.prepare('SELECT count(*) n FROM food_receipts').first()).n,0);
 assert.equal(ok(await f.get('receiver','b',{view:'incoming'})).counts.transfers,3);assert.equal(ok(await f.get('sender','a',{view:'incoming'})).counts.transfers,0);
 assert.match((await f.get()).headers.get('cache-control'),/no-store/);
});
test('manifest scope, exact label, day boundaries and missing input are explicit',async t=>{
 const f=await fixture(t);await addManifestTransfer(f.db,'bounds',{parcels:[parcel('prior',{departedAt:'2026-09-28T03:59:59Z'}),parcel('start',{departedAt:'2026-09-28T04:00:00Z'}),parcel('last',{departedAt:'2026-09-29T03:59:59.999Z'}),parcel('next',{departedAt:'2026-09-29T04:00:00Z'})]});
 assert.deepEqual(ok(await f.get()).entries[0].parcels.map(p=>p.id),['start','last']);assert.equal(ok(await f.get('sender','a',{trip:'trip 1'})).counts.parcels,0);assert.equal(ok(await f.get('sender','a',{dataset:'operating'})).counts.parcels,0);
 for(const actor of ['worker','foh','outsider'])assert.equal((await f.get(actor)).status,403);
 for(const query of [{trip:''},{date:''},{date:'2026-02-30'},{dataset:'other'},{view:'both'},{manifest:'yes'},{recordId:'bounds'}])assert.equal((await f.get('sender','a',query)).status,400,JSON.stringify(query));
});
test('manifest departure day includes both occurrences of a repeated clock hour',async t=>{
 const f=await fixture(t);await addManifestTransfer(f.db,'dst',{parcels:[parcel('first',{departedAt:'2026-11-01T05:30:00Z'}),parcel('second',{departedAt:'2026-11-01T06:30:00Z'}),parcel('last',{departedAt:'2026-11-02T04:59:59Z'}),parcel('next',{departedAt:'2026-11-02T05:00:00Z'})]});assert.equal(ok(await f.get('sender','a',{date:'2026-11-01'})).counts.parcels,3);
});
test('oversized manifest returns an error rather than a complete-looking partial result',async t=>{
 const f=await fixture(t);for(let i=0;i<4;i++)await addManifestTransfer(f.db,'many-'+i,{parcels:Array.from({length:50},(_,j)=>parcel('p-'+j))});assert.equal(ok(await f.get()).counts.parcels,200);
 await addManifestTransfer(f.db,'extra');const r=await f.get();assert.equal(r.status,413);assert.match(r.data.error,/no partial manifest/);assert.equal(r.data.entries,undefined);
});
test('changed food revision or revoked access during manifest loading discards the snapshot',async t=>{
 const f=await fixture(t);await addManifestTransfer(f.db,'one');
 const wrapped=mutation=>({withSession(){return this;},batch:f.db.batch.bind(f.db),prepare(sql){const stmt=f.db.prepare(sql);if(!sql.includes('json_each(t.data'))return stmt;return{bind(...args){const bound=stmt.bind(...args);return{async all(){const r=await bound.all();await mutation();return r;}}}};}});
 assert.equal((await f.get('sender','a',{},wrapped(()=>f.db.prepare("UPDATE food_state SET revision=revision+1 WHERE location_id='a'").run()))).status,409);
 assert.equal((await f.get('sender','a',{},wrapped(()=>f.db.prepare("UPDATE memberships SET capabilities='[]',revision=revision+1 WHERE id='sender'").run()))).status,403);
});
test('CSV preserves exact units and neutralizes spreadsheet formulas while excluding receiving totals',async t=>{
 const f=await fixture(t);const d=await addManifestTransfer(f.db,'formula');d.dispatch.reference='=SUM(1,2)';d.dispatch.item.title='@evil,"quoted"\nline';d.parcels[0].parcelReference='\t=1+2';await f.db.prepare('UPDATE food_transfers SET data=? WHERE id=?').bind(JSON.stringify(d),'formula').run();
 const csv=transferManifestCsv(ok(await f.get()));assert.equal(csv.charCodeAt(0),0xfeff);assert.match(csv,/"'=SUM\(1,2\)"/);assert.match(csv,/"'@evil,""quoted""\nline"/);assert.match(csv,/"'\t=1\+2"/);assert.match(csv,/"bag","1","25","lb"/);assert.doesNotMatch(csv,/accepted|rejected|Private/);assert.match(csv,/Transport snapshot only/);
});
