import {env} from 'cloudflare:workers';
import {handleToastDay} from '../../../shared/toast-day-service';
import {configuredToastDayReader} from '../../../shared/toast-supabase-reader';
export const dynamic='force-dynamic';
// This reads the latest successful private batch. It never calls ingestion.
export function GET(request:Request){return handleToastDay(request,env.DB,configuredToastDayReader(env));}
