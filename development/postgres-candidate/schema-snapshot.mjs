// Review evidence only: never apply this function snapshot as a deployment manifest.
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {connection} from './test-config.mjs';

export async function functionSnapshot(client){
 const version=Number((await client.query('SHOW server_version_num')).rows[0].server_version_num);
 if(version<170000||version>=180000)throw Error('Function snapshot requires PostgreSQL 17');
 await client.query('SET search_path=pg_catalog');
 const result=await client.query(`SELECT pg_get_functiondef(p.oid) definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='candidate_operations' AND p.prokind='f'
  ORDER BY p.proname COLLATE "C",pg_get_function_identity_arguments(p.oid) COLLATE "C"`);
 if(!result.rowCount)throw Error('Migrate the fresh candidate database before checking its snapshot');
 return '-- Generated from fresh PostgreSQL 17 candidate migrations; review evidence, not a deployment manifest.\n'
  +result.rows.map(r=>r.definition.replaceAll('\r\n','\n').trimEnd()+'\n').join('\n');
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const mode=process.argv[2];
 if(!['--check','--write'].includes(mode))throw Error('Use --check, or explicitly --write after reviewing a corrective migration');
 const client=new pg.Client({...connection,user:'candidate_owner'});await client.connect();
 try{
  const generated=await functionSnapshot(client),file=new URL('schema-snapshot.sql',import.meta.url);
  if(mode==='--write'){await writeFile(file,generated);console.log('Updated candidate function snapshot');}
  else if(await readFile(file,'utf8')!==generated)throw Error('Candidate function snapshot differs: review migration changes and regenerate explicitly on a fresh database');
  else console.log('Candidate function snapshot matches fresh migrated database');
 }finally{await client.end();}
}
