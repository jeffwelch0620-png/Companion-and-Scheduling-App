import test from 'node:test';import assert from 'node:assert/strict';
import {buildServiceCostReport,serviceCostReportCsv,validServiceCostReferences,createServiceCostReportLoader} from '../.sites-runtime/shared/maintenance-cost-report.mjs';
import {sources,modelWorkspace,range,now,fixture,cost} from './service-cost-report-fixture.mjs';
const build=(rows=sources())=>buildServiceCostReport(modelWorkspace(),range,rows,now);
test('allocation groups preserve original spellings, exact cents, identities and deterministic membership',()=>{
 const rows=sources();rows[4].cost.sourceRef='  DEMO   SHARED INVOICE ';rows[4].cost.allocation='Fictional second service share';
 const r=build(rows),g=r.referenceGroups[0];assert.equal(g.services,2);assert.equal(g.plans,2);assert.equal(g.amountCents,22539);assert.equal(g.documentDate,'2026-09-28');assert.equal(g.normalizedReference,'demo shared invoice');assert.deepEqual(g.references,['  DEMO   SHARED INVOICE ','DEMO shared invoice']);assert.deepEqual(g.members,[{planId:'plan-a',serviceId:'paid'},{planId:'plan-b',serviceId:'split'}]);assert.equal(r.totals.amountCents,24539);assert.deepEqual(build([...rows].reverse()).referenceGroups,r.referenceGroups);assert.equal(validServiceCostReferences(r),true);
});
test('zero-charge allocations count while withdrawn, invalid and voided amounts never join a group',()=>{
 const rows=sources();rows[1].cost.sourceRef='DEMO shared invoice';rows[3].cost.sourceRef='DEMO shared invoice';rows[2].cost=cost(-1);const r=build(rows),g=r.referenceGroups[0];assert.equal(g.services,3);assert.equal(g.amountCents,22539);assert.ok(g.members.some(m=>m.serviceId==='free'));assert.ok(!g.members.some(m=>['withdrawn','void'].includes(m.serviceId)));
});
test('different document dates and literal punctuation stay distinct, including formula-like references',()=>{
 const rows=sources();rows[4].cost.documentDate='2026-09-27';assert.equal(build(rows).referenceGroups.length,0);rows[4].cost.documentDate='2026-09-28';rows[0].cost.sourceRef='INV-1';rows[4].cost.sourceRef='INV 1';assert.equal(build(rows).referenceGroups.length,0);rows[0].cost.sourceRef='=TEST';rows[4].cost.sourceRef='=test';const r=build(rows);assert.equal(r.referenceGroups.length,1);assert.match(serviceCostReportCsv(r),/"'=TEST"/);
});
test('complete CSV carries review group identity, member count and allocated subtotal without changing report totals',()=>{
 const r=build(),csv=serviceCostReportCsv(r);assert.match(csv,/"reference_review_group","reference_group_services","reference_group_recorded_usd"/);assert.equal((csv.match(/"reference-1","2","225.39"/g)||[]).length,2);assert.match(csv,/"245.39"/);const copy=structuredClone(r);copy.referenceGroups[0].amountCents++;assert.equal(validServiceCostReferences(copy),false);assert.throws(()=>serviceCostReportCsv(copy),/complete/);
});
test('loader rejects missing or inconsistent allocation groups instead of showing unverified comparisons',async()=>{
 for(const change of [r=>delete r.referenceGroups,r=>r.referenceGroups[0].members.pop(),r=>r.referenceGroups[0].services++,r=>r.entries[0].repeatedReference=!r.entries[0].repeatedReference,r=>r.totals.repeatedReferenceGroups++]){
  const r=build();change(r);const seen=[],loader=createServiceCostReportLoader(x=>seen.push(x),async()=>Response.json(r));await loader.load('a','owner',1,range);assert.equal(seen.at(-1).data,null);assert.match(seen.at(-1).error,/changed/);
 }
});
test('endpoint compares only authorized plans and applied service dates; retired and filed evidence cannot leak through groups',async t=>{
 const f=await fixture(t);let row=await f.db.prepare("SELECT data FROM records WHERE id='a-plan-filed'").first();const data=JSON.parse(row.data);data.services[0].costHistory=[cost(2000)];await f.db.prepare("UPDATE records SET data=? WHERE id='a-plan-filed'").bind(JSON.stringify(data)).run();
 const owner=(await f.report()).data,manager=(await f.report('manager')).data;assert.equal(owner.referenceGroups[0].services,3);assert.equal(owner.referenceGroups[0].amountCents,24539);assert.equal(manager.referenceGroups[0].services,2);assert.ok(manager.referenceGroups[0].members.every(m=>m.planId!=='a-plan-filed'));assert.equal((await f.report('owner',{from:'2026-09-29'})).data.referenceGroups.length,0);assert.equal((await f.report('foreign',{locationId:'b'})).data.referenceGroups.length,0);
});
test('current correction and withdrawal remove a repeated group while preserving prior evidence',async t=>{
 const f=await fixture(t);const original=(await f.report()).data;assert.equal(original.referenceGroups.length,1);let r=(await f.view()).records.find(r=>r.id==='a-plan-a');const changed=await f.call('owner','maintenance.cost-withdraw',{serviceId:'paid',note:'Fictional allocation was assigned twice',confirmed:true},r);assert.equal(changed.status,200,JSON.stringify(changed.data));const latest=(await f.report()).data;assert.equal(latest.referenceGroups.length,0);assert.equal(latest.totals.amountCents,12000);r=await f.saved(changed.data);assert.equal(r.data.services.find(s=>s.id==='paid').costHistory.length,2);assert.equal(original.referenceGroups[0].amountCents,22539);
});
