// Use plain JavaScript config so schema generation also works on restricted Windows hosts.
import fs from 'node:fs';
import ts from 'typescript';
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
fs.mkdirSync('.sites-runtime', { recursive: true });
fs.writeFileSync('.sites-runtime/schema.mjs', ts.transpileModule(fs.readFileSync('db/schema.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText);
const journal = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8'));
const previousEntry = journal.entries.at(-1);
const previous = previousEntry ? JSON.parse(fs.readFileSync(`drizzle/meta/${String(previousEntry.idx).padStart(4, '0')}_snapshot.json`, 'utf8')) : await generateSQLiteDrizzleJson({});
const schema = await import(pathToFileURL(path.resolve('.sites-runtime/schema.mjs')));
const next = await generateSQLiteDrizzleJson(schema, previous.id);
const statements = await generateSQLiteMigration(previous, next);
if (statements.length) {
  const idx = journal.entries.length, tag = `${String(idx).padStart(4, '0')}_shared_workspace`;
  journal.entries.push({ idx, version: '6', when: Date.now(), tag, breakpoints: true });
  fs.writeFileSync(`drizzle/${tag}.sql`, statements.join('\n--> statement-breakpoint\n'));
  fs.writeFileSync(`drizzle/meta/${String(idx).padStart(4, '0')}_snapshot.json`, JSON.stringify(next, null, 2));
  fs.writeFileSync('drizzle/meta/_journal.json', JSON.stringify(journal, null, 2));
  console.log(`Generated ${statements.length} schema statements.`);
} else console.log('No schema changes.');
