import {env} from 'cloudflare:workers';
import {handleCateringSheet} from '../../../shared/catering-sheet-service';
export const dynamic='force-dynamic';
export function GET(request:Request){return handleCateringSheet(request,env.DB);}
