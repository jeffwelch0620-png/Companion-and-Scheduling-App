import {connection} from './test-config.mjs';
// Keep the browser's fictional Dishwasher date distinct from regression fixtures.
import pg from 'pg';import fs from 'node:fs';
const p=new URL('runtime/checkout-preview-fixture.json',import.meta.url),f=JSON.parse(fs.readFileSync(p));
const db=new pg.Pool({...connection,user:'candidate_owner'});
f.date=(await db.query("SELECT to_char(max(business_date)+1,'YYYY-MM-DD') d FROM candidate_operations.dish_cycles")).rows[0].d;
for(const s of f.shifts.filter(s=>s.actor!=='checkout-closer'))await db.query('UPDATE candidate_operations.shift_references SET starts_at=$2,ends_at=$3 WHERE id=$1',[s.id,f.date+'T12:00:00-04:00',f.date+'T20:00:00-04:00']);
fs.writeFileSync(p,JSON.stringify(f,null,2));console.log(f.date);await db.end();
