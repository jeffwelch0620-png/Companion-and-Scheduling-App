import {catalogFormat, catalogProject} from '../.sites-runtime/shared/food-catalog-review.mjs';
// Fictional definitions. Canonical store IDs test the actual routing contract;
// no restaurant operating data is used or persisted by these tests.
export function catalogFixture() {
  return {format: catalogFormat, source: {projectRef: catalogProject, label: 'Fictional catalog fixture', exportedAt: '2026-09-29T17:00:00.123456+00:00', dataset: 'demo', scope: 'partial'}, tables: {
    stores: ['berts', 'rudds', 'papa', 'comm'].map(id => ({id, name: `Fixture ${id}`, active: true, uses_commissary: id === 'berts' || id === 'rudds'})),
    items: [{code: 'papa_leonis_DEMO', name: 'Fictional flour', base_unit: 'oz', active: true}],
    store_items: [{store_id: 'papa', item_code: 'papa_leonis_DEMO', count_unit: 'bag', base_per_count_unit: 400, active: true, counted_nightly: true, needs_review: false}],
    vendor_items: [{id: 'pack1', vendor_id: 'fictional-vendor', vendor_sku: '001', item_code: 'papa_leonis_DEMO', purchase_unit: 'bag', base_per_purchase_unit: 400, pack_verified: true, preferred: true, available: true, price: 0, price_updated_at: '2026-09-29T17:00:00Z'}],
    dishes: [{id: 'dough', store_id: 'papa', name: 'Fictional dough', recipe_type: 'prep', yield_qty: 10, yield_uom: 'each'}],
    dish_lines: [{id: 'line1', dish_id: 'dough', source_type: 'item', item_code: 'papa_leonis_DEMO', prep_dish_id: null, qty: 8, uom: 'oz'}],
    prep_items: [{id: 'prep1', store_id: 'papa', name: 'Fictional prep', active: true, is_task: false, item_code: 'papa_leonis_DEMO', recipe_id: 'dough'}]
  }};
}
