import { env } from 'cloudflare:workers';
import { handleOwnerReview } from '../../../shared/owner-review';
export const dynamic='force-dynamic';
export function GET(request:Request){return handleOwnerReview(request,env.DB,env);}
export function POST(request:Request){return handleOwnerReview(request,env.DB,env);}
