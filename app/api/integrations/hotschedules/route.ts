import { env } from 'cloudflare:workers';
import { handleScheduleImport } from '../../../shared/schedule-import-service';
export const dynamic='force-dynamic';
export function GET(request:Request){return handleScheduleImport(request,env.DB);}
export function POST(request:Request){return handleScheduleImport(request,env.DB);}
