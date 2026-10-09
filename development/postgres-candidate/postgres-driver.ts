import pg from 'pg';
import type {Database,Transaction} from './task-adapter.ts';

export class PostgresDatabase implements Database {
 pool: pg.Pool;
 constructor(config: pg.PoolConfig) { this.pool=new pg.Pool(config); }
 async transaction<T>(operation: (connection: Transaction)=>Promise<T>): Promise<T> {
  const client=await this.pool.connect();
  let discarded=false;
  try {
   await client.query('BEGIN');
   await client.query("SET LOCAL statement_timeout='10s'");
   const connection: Transaction={query:async(sql,values)=> {
    const result=await client.query(sql,[...values]);return {rows:result.rows};
   }};
   const result=await operation(connection);
   await client.query('COMMIT');return result;
  } catch(error) {
   try { await client.query('ROLLBACK'); }
   catch { client.release(true); discarded=true; throw error; }
   throw error;
  } finally {
   if(!discarded) client.release();
  }
 }
 async close(){await this.pool.end();}
}
