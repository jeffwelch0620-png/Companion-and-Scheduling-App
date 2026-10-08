import {env} from 'cloudflare:workers';
import {handleFoodAdvisor} from '../../../shared/food-advisor-service';
import {configuredFoodAdvisorProvider} from '../../../shared/food-advisor-provider';
export const dynamic='force-dynamic';
export function GET(request:Request){return handleFoodAdvisor(request,env.DB,configuredFoodAdvisorProvider(env));}
export function POST(request:Request){return handleFoodAdvisor(request,env.DB,configuredFoodAdvisorProvider(env));}
