import { env } from 'cloudflare:workers';
import { handleRecordHistory } from '../../shared/history-service';
export const dynamic='force-dynamic';
export function GET(request:Request){return handleRecordHistory(request,env.DB);}
export function POST(request:Request){return handleRecordHistory(request,env.DB);}
