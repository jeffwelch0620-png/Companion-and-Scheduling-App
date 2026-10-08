import {env} from 'cloudflare:workers';
import {handleOrderGuide} from '../../../shared/food-order-guide-service';
export const dynamic='force-dynamic';
export function POST(request:Request){return handleOrderGuide(request,env.DB);}
