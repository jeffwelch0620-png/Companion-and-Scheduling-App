import {env} from 'cloudflare:workers';
import {handleSharedStore} from '../../shared/shared-store-service';
import type {SharedStoreBindings} from '../../shared/shared-store-contract';
export const dynamic='force-dynamic';
export function GET(request:Request){return handleSharedStore(request,env as unknown as SharedStoreBindings);}
export function POST(request:Request){return handleSharedStore(request,env as unknown as SharedStoreBindings);}

