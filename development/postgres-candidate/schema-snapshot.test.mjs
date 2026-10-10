import test from 'node:test';import assert from 'node:assert/strict';import pg from 'pg';
import {connection} from './test-config.mjs';import {functionSnapshot} from './schema-snapshot.mjs';
test('function snapshot detects live definition drift and is identical after rollback',async()=>{
 const client=new pg.Client({...connection,user:'candidate_owner'});await client.connect();
 try{
  const original=await functionSnapshot(client);assert.equal(original.includes('\r'),false);
  await client.query('BEGIN');
  const {definition,body}=(await client.query("SELECT pg_get_functiondef(oid) definition,prosrc body FROM pg_proc WHERE oid='candidate_operations.lock_scope(text,boolean)'::regprocedure")).rows[0];
  await client.query(definition.replace(body,body+'\n-- Fictional drift probe; transaction is rolled back.\n'));
  assert.notEqual(await functionSnapshot(client),original);
  await client.query('ROLLBACK');assert.equal(await functionSnapshot(client),original);
 }finally{await client.query('ROLLBACK').catch(()=>{});await client.end();}
});
