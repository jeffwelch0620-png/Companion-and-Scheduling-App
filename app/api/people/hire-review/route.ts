import {env} from 'cloudflare:workers';
import {handleHireReview} from '../../../shared/hire-review-service';
export const dynamic='force-dynamic';
export function GET(request:Request){return handleHireReview(request,env.DB);}
