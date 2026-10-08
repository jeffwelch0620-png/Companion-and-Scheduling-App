import {env} from 'cloudflare:workers';
import {handleServiceCostReport} from '../../../shared/maintenance-cost-report-service';
export const dynamic='force-dynamic';
export function GET(request:Request){return handleServiceCostReport(request,env.DB);}
