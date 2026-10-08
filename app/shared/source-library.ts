import { authenticateWorkspace, requireLocationAdministrator } from './service';
import { AppError, id, requireThat } from './validation';
import { sourceLibrary } from './source-library-data';
import { sourceCanPublish, type SourceDocument } from './source-library-types';

const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
export async function handleSourceLibrary(request:Request,binding?:D1Database) {
  try {
    requireThat(request.method==='GET','Method not allowed.',405);
    const {db,identity}=await authenticateWorkspace(request,binding),url=new URL(request.url);
    const locationId=id(url.searchParams.get('locationId'));
    await requireLocationAdministrator(db,identity,locationId);
    const documents:SourceDocument[]=sourceLibrary.documents.filter(d=>d.locationId===locationId).map(d=>({...d,publicationStatus:sourceCanPublish(d,sourceLibrary.conflicts)?'approved':'reference_only'}));
    const documentId=url.searchParams.get('documentId');
    if(documentId){const document=documents.find(d=>d.id===documentId);requireThat(document,'This source is not available at this restaurant.',404);return reply({document});}
    if(!documents.length)return reply({batchId:'',capturedAt:'',scope:'No reviewed source batch for this restaurant.',documents:[],conflicts:[]});
    const ids=new Set(documents.map(d=>d.id));
    return reply({...sourceLibrary,documents:documents.map(({content,...metadata})=>({...metadata,hasContent:!!content})),conflicts:sourceLibrary.conflicts.filter(c=>c.documentIds.some(id=>ids.has(id))).map(c=>({...c,documentIds:c.documentIds.filter(id=>ids.has(id))}))});
  }catch(error){return error instanceof AppError?reply({error:error.message},error.status):reply({error:'The source library could not load. Try again.'},503);}
}
