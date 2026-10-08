import { env } from 'cloudflare:workers';
import { handleWorkspaceSetup } from '../../shared/workspace-setup';
export const dynamic='force-dynamic';
export function GET(request:Request){return handleWorkspaceSetup(request,env.DB,env)}
export function POST(request:Request){return handleWorkspaceSetup(request,env.DB,env)}
