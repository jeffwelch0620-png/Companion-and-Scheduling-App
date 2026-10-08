import {env} from 'cloudflare:workers';
import {handleOperationsHandoff} from '../../../shared/operations-handoff';
export const dynamic='force-dynamic';
export function GET(request:Request){return handleOperationsHandoff(request,env.DB);}
