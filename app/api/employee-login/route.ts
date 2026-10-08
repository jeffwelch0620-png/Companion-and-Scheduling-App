import { env } from 'cloudflare:workers';
import { handleEmployeeLogin } from '../../shared/employee-login';
export const dynamic='force-dynamic';
export function GET(request:Request){return handleEmployeeLogin(request,env.DB,env);}
export function POST(request:Request){return handleEmployeeLogin(request,env.DB,env);}
