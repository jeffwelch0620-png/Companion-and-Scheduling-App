import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogFormat, catalogProject, catalogLimits, catalogReviewTemplate, reviewCatalogFile} from '../.sites-runtime/shared/food-catalog-review.mjs';

import {catalogFixture} from './food-catalog-fixture.mjs';

const review = f => reviewCatalogFile(JSON.stringify(f));
const findings = (r, code) => r.findings.filter(f => f.code === code);

test('exact canonical joins preserve legacy prefixes, zero prices and source declarations without mutation', () => {
  const f = catalogFixture(), before = JSON.stringify(f), r = review(f);
  assert.equal(r.errors, 0); assert.equal(r.rows, 10);
  assert.deepEqual(r.stores.map(s => [s.id, s.items, s.recipes, s.standingPrep]), [['berts', 0, 0, 0], ['rudds', 0, 0, 0], ['papa', 1, 1, 1], ['comm', 0, 0, 0]]);
  assert.equal(findings(r, 'price').length, 0); assert.equal(findings(r, 'recipe-unit').length, 1);
  assert.match(findings(r, 'recipe-unit')[0].message, /8 oz/);
  assert.equal(findings(r, 'connection').length, 1); assert.equal(findings(r, 'standing-prep').length, 2);
  assert.equal(JSON.stringify(f), before); assert.equal(r.source.exportedAt, f.source.exportedAt);
  assert.equal('ready' in r, false); assert.equal('importRows' in r, false);
});
test('foreign project, undeclared dataset and claimed completeness never establish readiness', () => {
  const f = catalogFixture(); f.source.projectRef = 'other'; f.source.dataset = 'unknown'; f.source.scope = 'claimed-complete';
  const r = review(f); assert.equal(findings(r, 'project').length, 1); assert.equal(findings(r, 'dataset').length, 1);
  assert.match(findings(r, 'scope')[0].message, /claims a complete/); assert.ok(r.errors > 0 && r.reviews > 0);
});
test('duplicate and malformed identities fail exact joins, including prototype-like and separator identifiers', () => {
  const f = catalogFixture(); f.tables.items.push({...f.tables.items[0]});
  let r = review(f); assert.equal(findings(r, 'duplicate').length, 1); assert.ok(findings(r, 'reference').length >= 3); assert.equal(r.stores.find(s => s.id === 'papa').items, 0);
  const g = catalogFixture(); g.tables.stores[2].id = ' papa '; r = review(g); assert.equal(findings(r, 'identifier').length, 1); assert.ok(findings(r, 'reference').length >= 3);
  const h = catalogFixture(); for (const row of h.tables.items) row.code = '__proto__';
  for (const table of ['store_items', 'vendor_items', 'dish_lines', 'prep_items']) for (const row of h.tables[table]) row.item_code = '__proto__';
  assert.equal(review(h).errors, 0);
  const j = catalogFixture(); j.tables.store_items.push({...j.tables.store_items[0]});
  r = review(j); assert.ok(findings(r, 'recipe-store').length); assert.equal(r.stores.find(s => s.id === 'papa').items, 0);
});
test('store, recipe and standing-prep links reject cross-restaurant joins and erroneous commissary flags', () => {
  const f = catalogFixture(); f.tables.stores[2].uses_commissary = true; f.tables.dishes[0].store_id = 'berts';
  f.tables.dishes.push({id: 'pizza', store_id: 'papa', name: 'Fictional pizza', recipe_type: 'menu', yield_qty: 1, yield_uom: 'each'});
  f.tables.dish_lines.push({id: 'line2', dish_id: 'pizza', source_type: 'prep', item_code: null, prep_dish_id: 'dough', qty: 1, uom: 'each'});
  const r = review(f); for (const code of ['commissary', 'recipe-store', 'prep-store', 'standing-prep-recipe']) assert.ok(findings(r, code).length, code);
});
test('unverified packs, numeric strings, stale stock claims and ambiguous supplier mappings remain visible', () => {
  const f = catalogFixture(), pack = f.tables.vendor_items[0]; pack.pack_verified = false; pack.base_per_purchase_unit = '400'; pack.price = '0';
  f.tables.vendor_items.push({...pack, id: 'pack2'}); f.tables.store_items[0].current_stock = 0; f.tables.store_items[0].needs_review = true;
  const r = review(f); for (const code of ['pack-unverified', 'quantity', 'price', 'supplier-duplicate', 'preferred-pack', 'stock', 'item-mapping']) assert.ok(findings(r, code).length, code);
  assert.equal(r.stores.find(s => s.id === 'papa').items, 1);
});
test('mixed ingredient sources, missing units, non-prep dependencies and cyclic recipes are diagnosed', () => {
  const f = catalogFixture(); f.tables.dish_lines[0].prep_dish_id = 'dough'; f.tables.dish_lines[0].uom = '';
  f.tables.dish_lines.push({id: 'cycle', dish_id: 'dough', source_type: 'prep', prep_dish_id: 'dough', item_code: null, qty: 1, uom: 'each'});
  let r = review(f); assert.ok(findings(r, 'line-source').length); assert.ok(findings(r, 'text').length); assert.ok(findings(r, 'recipe-cycle').length);
  f.tables.dishes[0].recipe_type = 'menu'; r = review(f); assert.ok(findings(r, 'prep-store').length);
});
test('input contract rejects other tables, malformed collections, invalid timestamps, coercion and oversized input', () => {
  assert.throws(() => reviewCatalogFile('not json'), /valid JSON/);
  assert.throws(() => review({items: []}), /shared catalog review format/);
  for (const mutate of [f => f.tables.people = [], f => f.tables.items = [null], f => delete f.tables.prep_items, f => f.source.dataset = ['demo'], f => f.source.exportedAt = '2026-02-30T12:00:00Z', f => f.source.exportedAt = '2026-09-29T24:00:00Z', f => f.source.exportedAt = '2026-09-29', f => f.source.token = 'not-a-real-credential']) {
    const f = catalogFixture(); mutate(f); assert.throws(() => review(f));
  }
  assert.throws(() => reviewCatalogFile(' '.repeat(catalogLimits.bytes + 1)), /5 MB/);
  const f = catalogFixture(); f.tables.items = Array.from({length: 20_001}, () => ({})); assert.throws(() => review(f), /20,000/);
  assert.equal(reviewCatalogFile('\uFEFF' + JSON.stringify(catalogFixture())).errors, 0);
});
test('empty tables are retained as absent coverage; template never invents an export time', () => {
  const f = JSON.parse(catalogReviewTemplate()); assert.equal(f.source.exportedAt, ''); assert.throws(() => review(f), /Source needs/);
  f.source.exportedAt = '2026-09-29T17:00:00Z'; const r = review(f);
  assert.equal(r.rows, 0); assert.equal(r.stores.length, 0); assert.equal(findings(r, 'standing-prep').length, 3); assert.equal(findings(r, 'missing-store').length, 3);
});
test('long dependency graph and excessive findings are bounded without skipping row inspection', () => {
  const f = catalogFixture(), n = 5_000;
  f.tables.dishes = Array.from({length: n}, (_, i) => ({id: `d${i}`, store_id: 'papa', name: `Fictional prep ${i}`, recipe_type: 'prep', yield_qty: 1, yield_uom: 'each'}));
  f.tables.dish_lines = Array.from({length: n - 1}, (_, i) => ({id: `l${i}`, dish_id: `d${i}`, source_type: 'prep', prep_dish_id: `d${i+1}`, item_code: null, qty: 1, uom: 'each'}));
  f.tables.prep_items = [];
  const r = review(f); assert.equal(r.errors, 0); assert.equal(r.counts.dish_lines, 4999); assert.equal(r.stores.find(s => s.id === 'papa').recipes, n);
  assert.equal(r.findings.length, catalogLimits.findings); assert.equal(r.errors + r.reviews, r.findings.length + r.omittedFindings); assert.ok(r.omittedFindings > 4_000);
});
