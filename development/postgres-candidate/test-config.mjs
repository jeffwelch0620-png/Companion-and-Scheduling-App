// Fictional candidate databases only. Never use production credentials here.
export const connection={host:'127.0.0.1',port:Number(process.env.CANDIDATE_PG_PORT||55461),database:process.env.CANDIDATE_TEST_DATABASE||'companion_candidate'};
if(!/^companion_candidate(?:_[a-z0-9_]+)?$/.test(connection.database))throw Error('Candidate database name required');
if(!Number.isInteger(connection.port)||connection.port<1||connection.port>65535)throw Error('Invalid candidate port');
