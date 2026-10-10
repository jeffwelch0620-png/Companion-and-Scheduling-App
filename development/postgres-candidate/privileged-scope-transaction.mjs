// Privileged candidate ingestion/setup only. No runtime or HTTP grant to lock_scope.
// SQL-only callbacks: retry the whole transaction on 40001 using the same import IDs.
export async function privilegedScopeTransaction(pool,scopes,operation){
 if(!Array.isArray(scopes)||!scopes.length||scopes.length>100||scopes.some(s=>typeof s!=='string'||!s.trim()||s.length>100))throw Error('Explicit candidate scopes required');
 const ordered=[...new Set(scopes)].sort(),client=await pool.connect();let discarded=false;
 try{
  await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='10s'");
  for(const scope of ordered)await client.query('SELECT candidate_operations.lock_scope($1)',[scope]);
  const result=await operation(client);await client.query('COMMIT');return result;
 }catch(error){
  try{await client.query('ROLLBACK');}catch{client.release(true);discarded=true;}
  throw error;
 }finally{if(!discarded)client.release();}
}
