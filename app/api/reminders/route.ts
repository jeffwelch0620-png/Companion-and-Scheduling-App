import { env } from 'cloudflare:workers';
import { handleReminders } from '../../shared/reminder-service';
export const dynamic='force-dynamic';
export function GET(request:Request){return handleReminders(request,env.DB);}
export function POST(request:Request){return handleReminders(request,env.DB);}
