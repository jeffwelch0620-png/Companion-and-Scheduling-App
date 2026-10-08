import { env } from 'cloudflare:workers';
import { handleSourceLibrary } from '../../shared/source-library';
export const dynamic='force-dynamic';
export function GET(request:Request){return handleSourceLibrary(request,env.DB);}
