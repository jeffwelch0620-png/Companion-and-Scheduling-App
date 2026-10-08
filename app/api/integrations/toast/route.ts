import { env } from 'cloudflare:workers';
import { handleToast } from '../../../shared/toast-service';
export const dynamic='force-dynamic';
export function GET(request:Request){return handleToast(request,env.DB,env);}
export function POST(request:Request){return handleToast(request,env.DB,env);}
