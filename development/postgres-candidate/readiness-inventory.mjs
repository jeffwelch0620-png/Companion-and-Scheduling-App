// Source inventory and classification drift check, not a runtime readiness verdict.
import { readFile, readdir, access } from 'node:fs/promises';
import ts from '../../node_modules/typescript/lib/typescript.js';
const root = new URL('../../', import.meta.url);
async function source(path) {
  return ts.createSourceFile(path, await readFile(new URL(path, root), 'utf8'), ts.ScriptTarget.Latest, true);
}
const types = await source('app/shared/types.ts');
const alias = types.statements.find(n => ts.isTypeAliasDeclaration(n) && n.name.text === 'DataMap');
if (!alias || !ts.isTypeLiteralNode(alias.type)) throw Error('DataMap shape requires inventory review');
const kinds = alias.type.members.map(n => n.name?.getText(types)).sort();
if (kinds.some(k => !k || !/^[a-z]+$/.test(k))) throw Error('Unexpected record kind syntax');
const tables = [], schema = await source('db/schema.ts');
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(schema) === 'sqliteTable' && ts.isStringLiteral(node.arguments[0]))
    tables.push(node.arguments[0].text);
  ts.forEachChild(node, visit);
}
visit(schema);
async function routes(path) {
  const files = [];
  for (const entry of await readdir(new URL(path + '/', root), {withFileTypes:true})) {
    if (entry.isDirectory()) files.push(...await routes(`${path}/${entry.name}`));
    else if (entry.name === 'route.ts') files.push(`${path}/route.ts`);
  }
  return files.sort();
}
const groups = JSON.parse(await readFile(new URL('workflow-coverage.json', import.meta.url), 'utf8')).groups;
const classified = groups.flatMap(g => g.kinds).sort();
if (JSON.stringify(classified) !== JSON.stringify(kinds)) throw Error('Record kind classification drift: review workflow-coverage.json');
for (const group of groups) {
  if (!['candidate-workflow','reference-only','not-migrated'].includes(group.status)) throw Error('Invalid coverage status');
  if (group.evidence) await access(new URL(group.evidence, import.meta.url));
}
const sourceRoutes = await routes('app/api');
console.log(JSON.stringify({ recordKindCount:kinds.length, sourceTableCount:tables.length,
  sourceRouteCount:sourceRoutes.length, groups, sourceTables:tables.sort(), sourceRoutes,
  verdict:'Coverage inventory only; active backend cutover is not ready.' }, null, 2));
