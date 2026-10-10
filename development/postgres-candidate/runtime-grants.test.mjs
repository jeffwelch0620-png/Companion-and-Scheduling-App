import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {randomUUID} from 'node:crypto';import pg from 'pg';import {connection} from './test-config.mjs';import {verifyMigrationManifest} from './migration-manifest.mjs';
test('migration-only database grants runtime entry access without fixture grants or table access',async()=>{
 // New fictional loopback database; retained for inspection, never reset or dropped.
 const name='companion_candidate_grants_'+randomUUID().replaceAll('-','');
 const control=new pg.Client({...connection,database:'postgres',user:'candidate_owner'});await control.connect();
 try{await control.query(`CREATE DATABASE "${name}" OWNER candidate_owner`);}finally{await control.end();}
 const owner=new pg.Client({...connection,database:name,user:'candidate_owner'});await owner.connect();
 try{
  await owner.query(`GRANT CREATE ON DATABASE "${name}" TO candidate_schema_owner`);
  await owner.query('GRANT USAGE,CREATE ON SCHEMA public TO candidate_schema_owner');
  await owner.query('SET ROLE candidate_schema_owner');
  for(const file of await verifyMigrationManifest())await owner.query(await readFile(new URL(file,import.meta.url),'utf8'));
  await owner.query('RESET ROLE');
  assert.equal((await owner.query("SELECT has_schema_privilege('candidate_runtime','candidate_operations','USAGE') allowed")).rows[0].allowed,true);
  const entries=await owner.query("SELECT p.oid,has_function_privilege('candidate_runtime',p.oid,'EXECUTE') allowed FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='candidate_operations' AND EXISTS(SELECT 1 FROM aclexplode(p.proacl) a JOIN pg_roles r ON r.oid=a.grantee WHERE r.rolname='candidate_runtime' AND a.privilege_type='EXECUTE')");
  assert.ok(entries.rowCount>20);assert.ok(entries.rows.every(r=>r.allowed));
  const tables=await owner.query("SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('candidate_identity','candidate_operations') AND c.relkind IN ('r','p') AND has_table_privilege('candidate_runtime',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')");assert.equal(tables.rowCount,0);
  for(const signature of ['publish_shift_core(text,uuid,text,uuid,jsonb,boolean)','publish_shift_core(text,uuid,text,uuid,jsonb,boolean,timestamp with time zone,timestamp with time zone)'])assert.equal((await owner.query("SELECT has_function_privilege('candidate_runtime',('candidate_operations.'||$1)::regprocedure,'EXECUTE') allowed",[signature])).rows[0].allowed,false);
 }finally{await owner.end();}
 const runtime=new pg.Client({...connection,database:name,user:'candidate_runtime'});await runtime.connect();
 try{
  // These calls must reach authorization checks, rather than fail on schema/function privileges.
  for(const sql of ["SELECT candidate_operations.command('fictional',$1,'fictional-empty',$2,'{}')","SELECT candidate_operations.read_task('fictional',$1,'fictional-empty',$2)","SELECT candidate_operations.resolve_identity('fictional',$1,'fictional-empty')"]){
   const args=sql.includes('$2')?[randomUUID(),randomUUID()]:[randomUUID()];
   await assert.rejects(runtime.query(sql,args),e=>['42501','22023'].includes(e.code)&&!e.message.includes('permission denied'));
  }
  await assert.rejects(runtime.query('SELECT * FROM candidate_operations.tasks'),e=>e.code==='42501');
 }finally{await runtime.end();}
});
