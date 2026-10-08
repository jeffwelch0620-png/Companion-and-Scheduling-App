import {env} from 'cloudflare:workers';
import {handleInvoiceArchive} from '../../../shared/invoice-archive-service';
export const dynamic='force-dynamic';
export function GET(request:Request){return handleInvoiceArchive(request,env.DB);}
export function POST(request:Request){return handleInvoiceArchive(request,env.DB);}
