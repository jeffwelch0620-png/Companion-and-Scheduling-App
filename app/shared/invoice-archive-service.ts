import {authenticateWorkspace,boundedJson} from './service';
import {context} from './food-service';
import {has} from './types';
import {listInvoiceArchives} from './invoice-archive-list';
import {AppError,id,object,requireThat} from './validation';
import {csvDigest,invoiceArchiveHash,invoiceArchiveMaxBytes,invoiceArchiveMaxFiles,parseInvoiceArchive,type InvoiceArchive} from './invoice-archive';
const headers={'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff'};
const projection='sha256,file_name AS fileName,byte_length AS byteLength,row_count AS rowCount,created_at AS createdAt';
export async function handleInvoiceArchive(request:Request,binding?:D1Database){
 try{
  requireThat(request.method==='GET'||request.method==='POST','Method not allowed.',405);
  requireThat(request.headers.get('Sec-Fetch-Site')!=='cross-site','Open this source from JMAX.',403);
  if(request.method==='POST'){
   requireThat(request.headers.get('Origin')===new URL(request.url).origin,'Open this source from JMAX.',403);
   requireThat(request.headers.get('Content-Type')?.split(';')[0]==='application/json','Use a JSON request.',415);
  }
  const auth=await authenticateWorkspace(request,binding),url=new URL(request.url);
  const body=request.method==='POST'?object(await boundedJson(request.body,1600000)):Object.fromEntries(url.searchParams);
  const listing=request.method==='GET'&&body.view==='list';
  const allowed=request.method==='POST'?['locationId','dataset','fileName','byteLength','sha256','csv','confirmed','layout']:listing?['locationId','dataset','view','q','after']:['locationId','dataset','sha256','download'];
  requireThat(Object.keys(body).every(k=>allowed.includes(k)),'Unexpected archive fields.');
  const locationId=id(body.locationId),dataset=body.dataset;requireThat(dataset==='demo'||dataset==='operating','Choose a food dataset.');
  const initial=await context(auth.db,auth.identity,locationId),w=initial.w;
  requireThat(has(w.me,'location.manage')||has(w.me,'orders.review'),'Invoice source files require purchasing access.',403);
  const fresh=async()=>{const a=await authenticateWorkspace(request,binding),c=await context(a.db,a.identity,locationId);requireThat(a.authUserId===auth.authUserId&&c.w.me.id===w.me.id&&c.membershipRevision===initial.membershipRevision&&c.w.location.revision===w.location.revision,'Restaurant access changed. Reopen this source.',409);};
  if(request.method==='GET'){
   if(listing){const page=await listInvoiceArchives(auth.db,locationId,dataset,body);await fresh();return Response.json(page,{headers});}
   const sha256=invoiceArchiveHash(body.sha256);requireThat(body.download===undefined||body.download==='1','Invalid download choice.');
   const file=await auth.db.prepare(`SELECT ${projection}${body.download?',csv':''} FROM invoice_files WHERE location_id=? AND dataset=? AND sha256=?`).bind(locationId,dataset,sha256).first<InvoiceArchive&{csv?:string}>();
   requireThat(file,'The original CSV has not been archived in these restaurant records.',404);
   if(body.download){requireThat(typeof file.csv==='string'&&new TextEncoder().encode(file.csv).byteLength===file.byteLength&&await csvDigest(file.csv)===sha256,'Archived CSV integrity check failed.',503);}
   await fresh();
   if(body.download)return new Response(new TextEncoder().encode(file.csv!),{headers:{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="invoice-source.csv"; filename*=UTF-8''${encodeURIComponent(file.fileName).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase())}`,'Content-Length':String(file.byteLength),'Content-Security-Policy':"sandbox; default-src 'none'"}});
   return Response.json({locationId,dataset,file},{headers});
  }
  const file=await parseInvoiceArchive(body);await fresh();
  // Immutable content identity makes retries idempotent. Capacity and access
  // are checked in the insert so concurrent requests cannot bypass the limit.
  await auth.db.prepare(`INSERT INTO invoice_files(location_id,dataset,sha256,file_name,byte_length,row_count,csv,created_at,created_by)
   SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM memberships WHERE id=? AND location_id=? AND auth_user_id=? AND active=1 AND revision=?)
   AND EXISTS(SELECT 1 FROM locations WHERE id=? AND revision=?)
   AND (SELECT COUNT(*) FROM invoice_files WHERE location_id=? AND dataset=?)<?
   AND (SELECT COALESCE(SUM(byte_length),0) FROM invoice_files WHERE location_id=? AND dataset=?)+?<=?
   ON CONFLICT(location_id,dataset,sha256) DO NOTHING`).bind(locationId,dataset,file.sha256,file.fileName,file.byteLength,file.rowCount,file.csv,new Date().toISOString(),w.me.id,w.me.id,locationId,auth.authUserId,initial.membershipRevision,locationId,w.location.revision,locationId,dataset,invoiceArchiveMaxFiles,locationId,dataset,file.byteLength,invoiceArchiveMaxBytes).run();
  await fresh();
  const saved=await auth.db.prepare(`SELECT ${projection} FROM invoice_files WHERE location_id=? AND dataset=? AND sha256=?`).bind(locationId,dataset,file.sha256).first<InvoiceArchive>();
  requireThat(saved,'CSV archive capacity reached. Existing sources remain available; ask an administrator to review storage capacity.',413);
  return Response.json({locationId,dataset,file:saved},{headers});
 }catch(e){return Response.json({error:e instanceof AppError?e.message:'Invoice source storage is unavailable.'},{status:e instanceof AppError?e.status:503,headers:{...headers,Allow:'GET, POST'}});}
}
