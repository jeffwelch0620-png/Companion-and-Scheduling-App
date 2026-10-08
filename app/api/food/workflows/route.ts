import {env} from 'cloudflare:workers';
import {handleFoodWorkflows} from '../../../shared/food-workflow-service';
export const dynamic='force-dynamic';
export function GET(request:Request){return handleFoodWorkflows(request,env.DB);}
export function POST(request:Request){return handleFoodWorkflows(request,env.DB);}
