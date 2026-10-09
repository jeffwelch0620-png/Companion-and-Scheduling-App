// JSON-lines transport preserving the original independent-session tests.
import pg from 'pg';import {createInterface} from 'node:readline';import {connection} from './test-config.mjs';
const client=new pg.Client({...connection,user:'candidate_runtime'});await client.connect();
try{for await(const line of createInterface({input:process.stdin})){try{const command=JSON.parse(line),result=await client.query(command.sql,command.values??[]);const rows=result.rows.map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,v!==null&&typeof v==='object'&&!(v instanceof Date)?JSON.stringify(v):v])));console.log(JSON.stringify({rows}));}catch(e){console.log(JSON.stringify({error:{code:e.code,message:e.message}}));}}}finally{await client.end();}
