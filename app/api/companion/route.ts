import { env } from 'cloudflare:workers';
import { handleCompanionChat } from '../../shared/companion-chat';
export const dynamic='force-dynamic';
export function GET(request:Request){return handleCompanionChat(request,env.DB,env,fetch,undefined,'workforce');}
export function POST(request:Request){return handleCompanionChat(request,env.DB,env,fetch,undefined,'workforce');}
