import {env} from 'cloudflare:workers';
import {handleToastSchedule} from '../../../shared/toast-schedule-service';
export const dynamic='force-dynamic';
export function GET(request:Request){return handleToastSchedule(request,env.DB,env);}
