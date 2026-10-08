import {env} from 'cloudflare:workers';
import {handleInvoiceCatalog} from '../../../shared/invoice-catalog-service';
export const dynamic='force-dynamic';
export function POST(request:Request){return handleInvoiceCatalog(request,env.DB);}
