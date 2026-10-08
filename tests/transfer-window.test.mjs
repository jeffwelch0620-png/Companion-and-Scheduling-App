import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,ok} from './maintenance-meter-fixture.mjs';
import {handleFoodTransfers} from '../.sites-runtime/shared/food-transfer-service.mjs';
import {transferWindow} from '../.sites-runtime/shared/food-transfer-window.mjs';

async function setup(t){
 const f=await fixture(t);
 await f.db.prepare("UPDATE locations SET timezone='America/Chicago' WHERE id='a'").run();
 const get=async(actor='owner',loc='a',params={})=>{
  const url='/api/food/transfers?'+new URLSearchParams({locationId:loc,dataset:'demo',view:loc==='a'?'outgoing':'incoming',status:'all',...params});
  if(f.compiled)return f.request(actor,url);
  const r=await handleFoodTransfers(new Request('http://localhost'+url,{headers:{'oai-authenticated-user-id':actor+'-identity','oai-authenticated-user-email':actor+'@example.test'}}),f.db);
  return {status:r.status,data:await r.json()};
 };
 const seed=async(id,at,extra={})=>{
  const {status='sent',dataset='demo',source='a',destination='b',receipt=null,recordedAt='2026-09-30T10:00:00Z',title='Fictional flour'}=extra;
  const data={sourceName:'Fictional A',destinationName:'Fictional B',dispatch:{reference:id,quantity:4,dispatchedAt:at,recordedAt,note:'Not searchable private note',by:'owner',byName:'Fixture owner',item:{id:'f',revision:1,title,controlNumber:'F',pack:{purchaseUnit:'bag',packCount:1,unitQty:25,unitUOM:'lb'}}},receipt};
  await f.db.prepare('INSERT INTO food_transfers(id,source_id,destination_id,dataset,reference_key,revision,status,data,updated_at) VALUES(?,?,?,?,?,1,?,?,?)').bind(id,source,destination,dataset,id,status,JSON.stringify(data),recordedAt).run();
 };
 return {...f,get,seed};
}
const day={from:'2026-09-28',through:'2026-09-28'};
test('dispatch window uses calendar midnight boundaries including 23/25-hour and non-hour-offset days',()=>{
 for(const [from,zone,start,end,hours] of [
  ['2026-03-08','America/Chicago','2026-03-08T06:00:00.000Z','2026-03-09T05:00:00.000Z',23],
  ['2025-11-02','America/Chicago','2025-11-02T05:00:00.000Z','2025-11-03T06:00:00.000Z',25],
  ['2026-09-28','Asia/Kathmandu','2026-09-27T18:15:00.000Z','2026-09-28T18:15:00.000Z',24]
 ]){const result=transferWindow(from,from,zone);assert.equal(result.start,start);assert.equal(result.end,end);assert.equal((Date.parse(end)-Date.parse(start))/3600000,hours);}
 assert.equal(transferWindow('','','America/Chicago').start,'');
});
test('restaurant day filters actual dispatch, includes final millisecond and excludes next midnight in API results',async t=>{
 const f=await setup(t);
 for(const [id,at] of [['before','2026-09-28T04:59:59.999Z'],['start','2026-09-28T05:00:00Z'],['middle','2026-09-28T23:30:00-05:00'],['end','2026-09-29T04:59:59.999Z'],['after','2026-09-29T05:00:00.000Z']])await f.seed(id,at);
 const rowsBefore=(await f.db.prepare('SELECT * FROM food_transfers ORDER BY sequence').all()).results;
 const p=ok(await f.get('owner','a',{...day,timezone:'UTC'}));
 assert.deepEqual(p.entries.map(x=>x.id),['end','middle','start']);assert.equal(p.total,3);assert.equal(p.totals.open,3);assert.deepEqual(p.window,{...day,timezone:'America/Chicago'});
 const dest=ok(await f.get('foreign','b',day));assert.deepEqual(dest.entries.map(x=>x.id),['start','before']);assert.equal(dest.window.timezone,'America/New_York');
 assert.equal(ok(await f.get()).total,5);assert.equal(ok(await f.get()).window.from,'');
 assert.deepEqual((await f.db.prepare('SELECT * FROM food_transfers ORDER BY sequence').all()).results,rowsBefore);
 assert.equal((await f.db.prepare('SELECT count(*) n FROM food_transfer_events').first()).n,0);
});
test('DST API windows include both repeated hours and exclude adjacent restaurant days',async t=>{
 const f=await setup(t);
 for(const [id,at] of [['before','2025-11-02T04:59:59Z'],['first','2025-11-02T06:30:00Z'],['second','2025-11-02T07:30:00Z'],['late','2025-11-03T05:59:59Z'],['next','2025-11-03T06:00:00Z']])await f.seed(id,at);
 const p=ok(await f.get('owner','a',{from:'2025-11-02',through:'2025-11-02'}));assert.deepEqual(p.entries.map(x=>x.id),['late','second','first']);
 await f.seed('spring-before','2026-03-08T05:59:59Z');await f.seed('spring-start','2026-03-08T06:00:00Z');await f.seed('spring-last','2026-03-09T04:59:59Z');await f.seed('spring-next','2026-03-09T05:00:00Z');
 assert.deepEqual(ok(await f.get('owner','a',{from:'2026-03-08',through:'2026-03-08'})).entries.map(x=>x.id),['spring-last','spring-start']);
});
test('range status counts span all matching pages and retain search/dataset/route scope',async t=>{
 const f=await setup(t);
 for(let i=0;i<23;i++)await f.seed('IN-'+i,'2026-09-28T12:00:00Z',{status:i===0?'received':i===1?'voided':'sent',receipt:i===0||i===2?{accepted:3,rejected:1,missing:0,receivedAt:'2026-09-30T08:00:00Z',complete:i===0}:null});
 await f.seed('older','2026-09-27T12:00:00Z');await f.seed('other-item','2026-09-28T12:00:00Z',{title:'Fictional salt'});await f.seed('operating','2026-09-28T12:00:00Z',{dataset:'operating'});await f.seed('foreign','2026-09-28T12:00:00Z',{source:'b',destination:'c'});
 const filter={...day,q:'flour'},first=ok(await f.get('owner','a',filter)),next=ok(await f.get('owner','a',{...filter,before:first.next,revision:first.revision}));
 assert.equal(first.entries.length,20);assert.equal(next.entries.length,3);assert.equal(first.total,23);assert.equal(next.total,23);assert.equal(next.next,null);assert.equal(new Set([...first.entries,...next.entries].map(x=>x.id)).size,23);
 assert.deepEqual(first.totals,{open:21,final:1,differences:2,voided:1});assert.deepEqual(next.totals,first.totals);assert.deepEqual(next.window,first.window);
 const differences=ok(await f.get('owner','a',{...filter,status:'differences'}));assert.equal(differences.total,2);assert.deepEqual(differences.totals,first.totals);
 assert.equal(ok(await f.get('owner','a',{...day,q:'private note'})).total,0);
 await f.db.prepare("INSERT INTO food_state(location_id,revision) VALUES('a',1) ON CONFLICT(location_id) DO UPDATE SET revision=revision+1").run();
 assert.equal((await f.get('owner','a',{...filter,before:first.next,revision:first.revision})).status,409);
});
test('invalid or incomplete dispatch ranges fail closed without broadening the result',async t=>{
 const f=await setup(t);await f.seed('row','2026-09-28T12:00:00Z');
 for(const params of [{from:'2026-09-28'},{through:'2026-09-28'},{from:'2026-02-30',through:'2026-03-01'},{from:'2026-09-29',through:'2026-09-28'},{from:'2025-01-01',through:'2026-01-02'},{from:"x' OR 1=1",through:'2026-09-28'}])assert.equal((await f.get('owner','a',params)).status,400,JSON.stringify(params));
 assert.equal(ok(await f.get('owner','a',{from:'2026-01-01',through:'2026-12-31'})).total,1);
});
test('date filtering preserves role/store boundaries and independent transfer detail access',async t=>{
 const f=await setup(t);await f.seed('record','2026-09-28T12:00:00Z');
 await f.db.prepare("UPDATE memberships SET area='FOH' WHERE id='manager'").run();
 for(const [actor,loc] of [['worker','a'],['owner','b'],['foreign','a'],['manager','a']])assert.equal((await f.get(actor,loc,day)).status,403,actor+' '+loc);
 assert.equal(ok(await f.get('third','c',day)).total,0);
 assert.equal(ok(await f.get('owner','a',{from:'2026-09-29',through:'2026-09-29'})).total,0);
 assert.equal(ok(await f.get('owner','a',{recordId:'record',...day})).transfer.id,'record');
 assert.equal((await f.get('third','c',{recordId:'record',...day})).status,404);
});
