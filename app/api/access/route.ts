import { env } from 'cloudflare:workers';
import { handleAccess } from '../../shared/access-service';
export const dynamic='force-dynamic';
export function GET(request:Request){return handleAccess(request,env.DB,env);}
export function POST(request:Request){return handleAccess(request,env.DB,env);}
