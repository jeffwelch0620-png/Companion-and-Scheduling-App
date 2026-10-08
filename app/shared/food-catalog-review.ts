// Read-only review contract for the normalized shared catalog. This is not an
// importer or a proof that a file came from the named Supabase project.
export const catalogFormat = 'jmax-shared-catalog-review-v1';
export const catalogProject = 'yrlhwcoirgqmtlvvnzvo';
export const catalogTables = ['stores', 'items', 'store_items', 'vendor_items', 'dishes', 'dish_lines', 'prep_items'] as const;
export const catalogLimits = {bytes: 5_000_000, rows: 20_000, findings: 200};
type Table = typeof catalogTables[number];
type Row = Record<string, unknown>;
type Severity = 'error' | 'review';
export type CatalogFinding = {severity: Severity; code: string; path: string; message: string};
export type CatalogReview = {
  source: {projectRef: string; label: string; exportedAt: string; dataset: string; scope: string};
  counts: Record<Table, number>; rows: number;
  stores: {id: string; name: string; items: number; recipes: number; standingPrep: number; usesCommissary: boolean | null}[];
  findings: CatalogFinding[]; errors: number; reviews: number; omittedFindings: number;
};
const record = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 120): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && v.trim() === v && !/[\x00-\x1f]/.test(v);
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const nonnegative = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const key = (...parts: unknown[]) => JSON.stringify(parts);
function fail(message: string): never {throw new Error(message)}
const isoTime = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(v) || !Number.isFinite(Date.parse(v))) return false;
  const day = new Date(`${v.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === v.slice(0, 10) && +v.slice(11, 13) < 24 && +v.slice(14, 16) < 60 && +v.slice(17, 19) < 60;
};

export function reviewCatalogFile(raw: string): CatalogReview {
  if (new TextEncoder().encode(raw).length > catalogLimits.bytes) fail('Use a catalog review file no larger than 5 MB.');
  let input: unknown;
  try {input = JSON.parse(raw.replace(/^\uFEFF/, ''))} catch {fail('Choose a valid JSON catalog review file.')}
  if (!record(input) || input.format !== catalogFormat || !record(input.source) || !record(input.tables)) fail('Use the shared catalog review format. Jeff’s original item/recipe export uses the separate import above.');
  if (Object.keys(input).some(k => !['format', 'source', 'tables'].includes(k))) fail('Include only format, source and tables in a catalog review file.');
  if (Object.keys(input.tables).some(k => !catalogTables.includes(k as Table))) fail('This review accepts only the seven catalog tables; exclude invoices, people, credentials and operating records.');
  const s = input.source;
  if (Object.keys(s).some(k => !['projectRef', 'label', 'exportedAt', 'dataset', 'scope'].includes(k))) fail('Source accepts only projectRef, label, exportedAt, dataset and scope.');
  if (!str(s.projectRef) || !str(s.label, 300) || !isoTime(s.exportedAt) || typeof s.dataset !== 'string' || !['demo', 'operating', 'unknown'].includes(s.dataset) || typeof s.scope !== 'string' || !['partial', 'claimed-complete'].includes(s.scope)) fail('Source needs projectRef, label, exportedAt with timezone, dataset (demo/operating/unknown), and scope (partial/claimed-complete).');
  const counts = {} as Record<Table, number>, tables = {} as Record<Table, Row[]>;
  let rows = 0;
  for (const table of catalogTables) {
    const list = input.tables[table];
    if (!Array.isArray(list) || list.some(r => !record(r))) fail(`Include ${table} as an array of objects, even when empty.`);
    rows += list.length;
    if (rows > catalogLimits.rows) fail('Split catalog reviews larger than 20,000 total rows.');
    tables[table] = list; counts[table] = list.length;
  }
  const result: CatalogReview = {source: {projectRef: s.projectRef, label: s.label, exportedAt: s.exportedAt, dataset: String(s.dataset), scope: String(s.scope)}, counts, rows, stores: [], findings: [], errors: 0, reviews: 0, omittedFindings: 0};
  const add = (severity: Severity, code: string, path: string, message: string) => {
    severity === 'error' ? result.errors++ : result.reviews++;
    if (result.findings.length < catalogLimits.findings) result.findings.push({severity, code, path, message}); else result.omittedFindings++;
  };
  if (s.projectRef !== catalogProject) add('error', 'project', 'source.projectRef', 'The declared project does not match the current JMAX shared project.');
  if (s.dataset === 'unknown') add('review', 'dataset', 'source.dataset', 'The source has not declared whether these are operating or practice definitions.');
  add('review', 'scope', 'source.scope', s.scope === 'partial' ? 'This is a declared partial export. Missing references may be outside this file.' : 'The file claims a complete catalog. Reconcile source totals before relying on that claim.');
  add('review', 'connection', 'source', 'File review does not verify source authenticity, restaurant access policies, shared sign-in or permission to connect.');
  const indexes = {} as Record<Table, Map<string, Row>>;
  const idFields: Record<Table, string[]> = {stores: ['id'], items: ['code'], store_items: ['store_id', 'item_code'], vendor_items: ['id'], dishes: ['id'], dish_lines: ['id'], prep_items: ['id']};
  for (const table of catalogTables) {
    const index = new Map<string, Row>(), duplicates = new Set<string>(); indexes[table] = index;
    tables[table].forEach((r, i) => {
      const fields = idFields[table], values = fields.map(f => r[f]);
      if (values.some(v => !str(v))) {add('error', 'identifier', `${table}[${i}]`, `Supply exact nonblank text identifiers: ${fields.join(', ')}. Identifiers are never trimmed, renamed or inferred.`); return}
      const id = key(...values);
      if (index.has(id) || duplicates.has(id)) {index.delete(id); duplicates.add(id); add('error', 'duplicate', `${table}[${i}]`, `Repeated ${fields.join('/')} identity. References to it are ambiguous.`)} else index.set(id, r);
    });
  }
  const ref = (table: Table, value: unknown, path: string) => {
    const row = str(value) ? indexes[table].get(key(value)) : undefined;
    if (!row) add('error', 'reference', path, `Missing or ambiguous ${table} reference. Exact identifiers must be supplied in this file.`);
    return row;
  };
  const requiredText = (r: Row, field: string, path: string) => {if (!str(r[field], 300)) add('error', 'text', `${path}.${field}`, 'Supply a nonblank text value.')};
  const requirePositive = (r: Row, field: string, path: string) => {if (!positive(r[field])) add('review', 'quantity', `${path}.${field}`, 'A positive numeric value is required; blank, zero and numeric strings are not converted.')};
  const requireBool = (r: Row, field: string, path: string) => {if (typeof r[field] !== 'boolean') add('error', 'boolean', `${path}.${field}`, 'Supply an explicit true or false value.')};
  const storeStats = new Map<string, CatalogReview['stores'][number]>();
  const expected = new Map([['berts', true], ['rudds', true], ['papa', false], ['comm', false]]);
  for (const [i, r] of tables.stores.entries()) {
    const path = `stores[${i}]`; requiredText(r, 'name', path); requireBool(r, 'active', path); requireBool(r, 'uses_commissary', path);
    if (!str(r.id) || indexes.stores.get(key(r.id)) !== r) continue;
    storeStats.set(r.id, {id: r.id, name: str(r.name, 300) ? r.name : r.id, items: 0, recipes: 0, standingPrep: 0, usesCommissary: typeof r.uses_commissary === 'boolean' ? r.uses_commissary : null});
    if (!expected.has(r.id)) add('review', 'store-mapping', path, 'Unrecognized store identifier. An owner must reconcile the mapping; names and item prefixes do not establish it.');
    else if (r.uses_commissary !== expected.get(r.id)) add('error', 'commissary', path, 'Only Bert’s and Rudd’s bulk counts feed commissary. Reconcile this flag before integration.');
  }
  for (const id of ['berts', 'rudds', 'papa']) if (!indexes.stores.has(key(id))) add('review', 'missing-store', 'stores', `The file does not include an unambiguous ${id} store. All three restaurants need next-day prep.`);
  const assignedItems = new Set<string>();
  tables.items.forEach((r, i) => {
    const path = `items[${i}]`; requiredText(r, 'name', path); requiredText(r, 'base_unit', path); requireBool(r, 'active', path);
  });
  tables.store_items.forEach((r, i) => {
    const path = `store_items[${i}]`, store = ref('stores', r.store_id, `${path}.store_id`), item = ref('items', r.item_code, `${path}.item_code`);
    if (store && item && indexes.store_items.get(key(r.store_id, r.item_code)) === r) {storeStats.get(String(r.store_id))!.items++; assignedItems.add(String(r.item_code))}
    requiredText(r, 'count_unit', path); requirePositive(r, 'base_per_count_unit', path); requireBool(r, 'active', path); requireBool(r, 'counted_nightly', path); requireBool(r, 'needs_review', path);
    if (r.needs_review === true) add('review', 'item-mapping', path, 'Source marks this restaurant/item mapping as needing review.');
    if (r.current_stock != null || r.last_counted != null || r.last_counted_at != null) add('review', 'stock', path, 'Source stock/count fields are historical claims. They are not imported as a current physical count.');
  });
  for (const [id, r] of indexes.items) if (!assignedItems.has(String(r.code))) add('review', 'unassigned-item', `items:${id}`, 'No unambiguous restaurant assignment in this file.');
  const supplierKeys = new Set<string>(), preferred = new Map<string, number>();
  tables.vendor_items.forEach((r, i) => {
    const path = `vendor_items[${i}]`; ref('items', r.item_code, `${path}.item_code`);
    for (const field of ['vendor_id', 'vendor_sku', 'purchase_unit']) requiredText(r, field, path);
    requireBool(r, 'preferred', path); requireBool(r, 'available', path);
    if (r.pack_verified !== true) add('review', 'pack-unverified', path, 'Supplier pack is not explicitly verified in this file. Do not trust pack conversions yet.');
    requirePositive(r, 'base_per_purchase_unit', path);
    if (!nonnegative(r.price) || !isoTime(r.price_updated_at)) add('review', 'price', path, 'Supplier price needs a nonnegative number and a dated source with timezone. Zero is kept as zero.');
    if (str(r.vendor_id) && str(r.vendor_sku)) {const identity = key(r.vendor_id, r.vendor_sku); if (supplierKeys.has(identity)) add('error', 'supplier-duplicate', path, 'The same supplier/SKU is mapped more than once; resolve its item/pack identity.'); supplierKeys.add(identity)}
    if (str(r.item_code) && r.available === true && r.preferred === true) preferred.set(r.item_code, (preferred.get(r.item_code) ?? 0) + 1);
  });
  for (const code of assignedItems) if (preferred.get(code) !== 1) add('review', 'preferred-pack', `items:${code}`, 'Choose exactly one available preferred supplier pack before using costs.');
  const recipeEdges = new Map<string, Set<string>>(), lineCounts = new Map<string, number>();
  tables.dishes.forEach((r, i) => {
    const path = `dishes[${i}]`, store = ref('stores', r.store_id, `${path}.store_id`);
    requiredText(r, 'name', path); requiredText(r, 'yield_uom', path); requirePositive(r, 'yield_qty', path);
    if (r.recipe_type !== 'menu' && r.recipe_type !== 'prep') add('error', 'recipe-type', path, 'Recipe type must be menu or prep.');
    if (str(r.id) && indexes.dishes.get(key(r.id)) === r) {recipeEdges.set(r.id, new Set()); if (store) storeStats.get(String(r.store_id))!.recipes++}
  });
  tables.dish_lines.forEach((r, i) => {
    const path = `dish_lines[${i}]`, dish = ref('dishes', r.dish_id, `${path}.dish_id`);
    requirePositive(r, 'qty', path); requiredText(r, 'uom', path);
    if (dish) lineCounts.set(String(r.dish_id), (lineCounts.get(String(r.dish_id)) ?? 0) + 1);
    if (r.source_type === 'item') {
      ref('items', r.item_code, `${path}.item_code`);
      if (r.prep_dish_id != null) add('error', 'line-source', path, 'An item line must not also identify a prep recipe.');
      if (dish && !indexes.store_items.has(key(dish.store_id, r.item_code))) add('error', 'recipe-store', path, 'Ingredient has no unambiguous assignment to the recipe’s restaurant.');
    } else if (r.source_type === 'prep') {
      const prep = ref('dishes', r.prep_dish_id, `${path}.prep_dish_id`);
      if (r.item_code != null) add('error', 'line-source', path, 'A prep line must not also identify an item.');
      if (prep && (prep.recipe_type !== 'prep' || !dish || prep.store_id !== dish.store_id)) add('error', 'prep-store', path, 'Nested prep must be a prep recipe in the same restaurant. Cross-store supply needs a separate agreed route.');
      if (prep && dish) recipeEdges.get(String(r.dish_id))?.add(String(r.prep_dish_id));
    } else add('error', 'line-source', path, 'Ingredient source must be item or prep.');
    if (positive(r.qty) && str(r.uom)) add('review', 'recipe-unit', path, `Quantity ${r.qty} ${r.uom} has an explicit measure. Reconcile it with portion/yield units before connecting; it must not be silently treated as a portion count.`);
  });
  for (const id of recipeEdges.keys()) if (!lineCounts.has(id)) add('review', 'empty-recipe', `dishes:${id}`, 'No ingredient lines in this file. A missing recipe is not a zero cost.');
  // Iterative DFS stays bounded even for a 20,000-row chain. No recursive stack.
  const colour = new Map<string, number>();
  for (const start of recipeEdges.keys()) {
    if (colour.has(start)) continue;
    colour.set(start, 1);
    const stack = [{id: start, edges: [...recipeEdges.get(start)!], next: 0}];
    while (stack.length) {
      const frame = stack[stack.length - 1], target = frame.edges[frame.next++];
      if (target === undefined) {colour.set(frame.id, 2); stack.pop(); continue}
      if (colour.get(target) === 1) add('error', 'recipe-cycle', `dishes:${frame.id}`, `Circular prep dependency includes ${target}.`);
      else if (!colour.has(target)) {colour.set(target, 1); stack.push({id: target, edges: [...(recipeEdges.get(target) ?? [])], next: 0})}
    }
  }
  tables.prep_items.forEach((r, i) => {
    const path = `prep_items[${i}]`, store = ref('stores', r.store_id, `${path}.store_id`);
    requiredText(r, 'name', path); requireBool(r, 'active', path); requireBool(r, 'is_task', path);
    if (store && indexes.prep_items.get(key(r.id)) === r) storeStats.get(String(r.store_id))!.standingPrep++;
    if (r.item_code != null) {ref('items', r.item_code, `${path}.item_code`); if (store && !indexes.store_items.has(key(r.store_id, r.item_code))) add('error', 'prep-item-store', path, 'Standing prep item is not assigned to this restaurant.')}
    if (r.recipe_id != null) {const recipe = ref('dishes', r.recipe_id, `${path}.recipe_id`); if (recipe && (recipe.store_id !== r.store_id || recipe.recipe_type !== 'prep')) add('error', 'standing-prep-recipe', path, 'Standing prep must reference a prep recipe in the same restaurant.')}
    if (r.is_task === false && r.item_code == null && r.recipe_id == null) add('review', 'prep-source', path, 'Food prep has neither an item nor a recipe reference. Reconcile its source.');
  });
  result.stores = [...storeStats.values()];
  for (const id of ['berts', 'rudds', 'papa']) if (!storeStats.get(id)?.standingPrep) add('review', 'standing-prep', `stores:${id}`, 'No standing prep rows for this restaurant in the file. Recipe definitions alone do not establish next-day prep.');
  return result;
}

export function catalogReviewTemplate(): string {
  return JSON.stringify({format: catalogFormat, source: {projectRef: catalogProject, label: 'Replace with checked source/version', exportedAt: '', dataset: 'unknown', scope: 'partial'}, tables: Object.fromEntries(catalogTables.map(name => [name, []]))}, null, 2);
}
