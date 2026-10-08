import {env} from 'cloudflare:workers';
import {handleFoodTransfers} from '../../../shared/food-transfer-service';
export const dynamic='force-dynamic';
export function GET(request:Request){return handleFoodTransfers(request,env.DB);}
export function POST(request:Request){return handleFoodTransfers(request,env.DB);}
