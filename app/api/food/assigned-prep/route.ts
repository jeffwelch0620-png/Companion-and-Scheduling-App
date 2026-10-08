import {env} from 'cloudflare:workers';
import {handleEmployeePrep} from '../../../shared/employee-prep-service';
export const dynamic='force-dynamic';
export function GET(request:Request){return handleEmployeePrep(request,env.DB);}
