import {env} from 'cloudflare:workers';
import {handleSharedStoreSession} from '../../../shared/shared-store-service';
import type {SharedStoreBindings} from '../../../shared/shared-store-contract';
export const dynamic='force-dynamic';
export function GET(request:Request){return handleSharedStoreSession(request,env as unknown as SharedStoreBindings);}
export function POST(request:Request){return handleSharedStoreSession(request,env as unknown as SharedStoreBindings);}
