import { env } from 'cloudflare:workers';
import { handleWorkspace } from '../../shared/service';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return handleWorkspace(request, env.DB); }
export function POST(request: Request) { return handleWorkspace(request, env.DB); }
