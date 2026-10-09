// Opt-in setup on a loopback, disposable PostgreSQL test server only.
import pg from 'pg';import {readFile,readdir,mkdir} from 'node:fs/promises';import {connection} from './test-config.mjs';
import {verifyMigrationManifest} from './migration-manifest.mjs';
if(process.env.CANDIDATE_ALLOW_BOOTSTRAP!=='fictional-local-only')throw Error('Set CANDIDATE_ALLOW_BOOTSTRAP=fictional-local-only for a disposable local test server');
const migrations=await verifyMigrationManifest();
const admin=new pg.Client({host:connection.host,port:connection.port,database:'postgres',user:process.env.CANDIDATE_BOOTSTRAP_USER||'postgres'});await admin.connect();
try{
 for(const [role,options] of [['candidate_owner','LOGIN SUPERUSER'],['candidate_schema_owner','NOLOGIN NOSUPERUSER NOBYPASSRLS'],['candidate_runtime','LOGIN NOSUPERUSER NOBYPASSRLS']]){
  if(!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount)await admin.query(`CREATE ROLE ${role} ${options}`);
 }
 const runtime=(await admin.query("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='candidate_runtime'")).rows[0];if(runtime.rolsuper||runtime.rolbypassrls)throw Error('Candidate runtime must be restricted');
 if((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[connection.database])).rowCount)throw Error('Database already exists; choose a NEW CANDIDATE_TEST_DATABASE. No reset/drop is performed.');
 await admin.query(`CREATE DATABASE "${connection.database}" OWNER candidate_owner`);
}finally{await admin.end();}
const db=new pg.Client({...connection,user:'candidate_owner'});await db.connect();
try{
 await db.query(`GRANT CREATE ON DATABASE "${connection.database}" TO candidate_schema_owner`);
 await db.query('GRANT USAGE,CREATE ON SCHEMA public TO candidate_schema_owner');
 for(const name of migrations){await db.query('SET ROLE candidate_schema_owner');await db.query(await readFile(new URL(name,import.meta.url),'utf8'));console.log('Applied '+name);if(name.startsWith('001_'))await db.query(await readFile(new URL('test-fixture.sql',import.meta.url),'utf8'));}
 await db.query('SET ROLE candidate_schema_owner');
 for(const [i,subject] of ['manager','employee','peer','foreign'].entries())await db.query("INSERT INTO candidate_identity.sessions(id,subject,expires_at) VALUES($1,$2,clock_timestamp()+interval '4 hours')",['20000000-0000-0000-0000-00000000000'+(i+1),subject]);
 await db.query(await readFile(new URL('shift-preview-fixture.sql',import.meta.url),'utf8'));
 await mkdir(new URL('runtime/',import.meta.url),{recursive:true});
 console.log('Fictional candidate ready: '+connection.database);
}finally{await db.end();}
