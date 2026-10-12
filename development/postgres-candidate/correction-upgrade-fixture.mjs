// Serial fictional tests only. Caller owns a transaction and must roll it back.
// Reproduce the 055 ledger/function shape without changing historical migrations or events.
import {readFile} from 'node:fs/promises';
export async function legacyCorrectionShape(client){
 const source=(await readFile(new URL('055_completed_shift_corrections.sql',import.meta.url),'utf8')).replaceAll('\r\n','\n');
 for(const name of ['guard_completed_correction_origin','correction_source_matches','correction_actions','completed_shift_correction_command','completed_correction_json','completed_shift_review_json']){
  const start=source.indexOf('CREATE FUNCTION candidate_operations.'+name+'('),end=source.indexOf('\n$$;',start)+4;
  if(start<0||end<start)throw Error('Missing legacy correction definition');
  await client.query(source.slice(start,end).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'));
 }
 await client.query('ALTER TABLE candidate_operations.completed_shift_corrections DROP COLUMN source_key');
}
export async function upgradeCorrectionShape(client){
 const source=await readFile(new URL('056_correction_source_and_reporting.sql',import.meta.url),'utf8');
 await client.query(source.replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,''));
 // Reapply current read projections/indexes after reproducing historical 055/056 shapes.
 const board=await readFile(new URL('057_bounded_correction_board.sql',import.meta.url),'utf8');
 await client.query(board.replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'').replaceAll('CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS ').replaceAll('CREATE FUNCTION ', 'CREATE OR REPLACE FUNCTION '));
}
