import { env } from 'cloudflare:workers';
import { handleScheduleTransfer } from '../../shared/schedule-transfer';
export const dynamic='force-dynamic';
export function GET(request:Request){return handleScheduleTransfer(request,env.DB);}
export function POST(request:Request){return handleScheduleTransfer(request,env.DB);}
