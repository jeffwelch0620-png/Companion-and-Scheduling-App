import {env} from 'cloudflare:workers';
import {handleFood} from '../../shared/food-service';
export const dynamic='force-dynamic';
export function GET(request:Request){return handleFood(request,env.DB);}
export function POST(request:Request){return handleFood(request,env.DB);}
