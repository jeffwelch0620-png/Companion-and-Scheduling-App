import {connection} from './test-config.mjs';
// Fictional loopback harness only. No real Supabase or production identities.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {generateKeyPair,exportJWK,createLocalJWKSet,SignJWT} from 'jose';
import {PostgresDatabase} from './postgres-driver.ts';
import {createTaskHandler,makeJwtVerifier} from './task-http.ts';
const db=new PostgresDatabase({...connection,user:'candidate_runtime'});
const port=Number(process.env.CANDIDATE_PREVIEW_PORT||6610);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid fictional preview port');
const {privateKey,publicKey}=await generateKeyPair('ES256');
const jwk=await exportJWK(publicKey);jwk.kid='fictional-browser-key';
const issuer='https://fictional.invalid/auth/v1';
const handler=createTaskHandler(db,makeJwtVerifier({issuer,audience:'authenticated',getKey:createLocalJWKSet({keys:[jwk]})}));
const nightFixture=JSON.parse(await readFile(new URL('runtime/overnight-preview-fixture.json',import.meta.url),'utf8'));
const checkoutFixture=JSON.parse(await readFile(new URL('runtime/checkout-preview-fixture.json',import.meta.url),'utf8'));
const scheduleFixture=JSON.parse(await readFile(new URL('runtime/schedule-preview-fixture.json',import.meta.url),'utf8'));
Object.assign(nightFixture.sessions,checkoutFixture.sessions,scheduleFixture.sessions);
const session={manager:'20000000-0000-0000-0000-000000000001',employee:'20000000-0000-0000-0000-000000000002',...Object.fromEntries(Object.entries(nightFixture.sessions).map(([key,value])=>[key,value.id]))};
const files={'/':['browser-harness.html','text/html'],'/forms':['runtime/forms-dist/forms-preview.html','text/html'],'/overnight-forms':['runtime/forms-dist/overnight-preview.html','text/html'],'/overnight-fixture':['runtime/overnight-preview-fixture.json','application/json'],'/browser-harness.mjs':['browser-harness.mjs','text/javascript'],
 '/offline-task-queue.mjs':['offline-task-queue.mjs','text/javascript']};
files['/schedule-forms']=['runtime/forms-dist/schedule-preview.html','text/html'];
files['/checkout-forms']=['runtime/forms-dist/checkout-preview.html','text/html'];
files['/checkout-fixture']=['runtime/checkout-preview-fixture.json','application/json'];
files['/checkout-offline-worker.js']=['runtime/forms-dist/checkout-offline-worker.js','text/javascript'];
files['/checkout-shell.json']=['runtime/forms-dist/checkout-shell.json','application/json'];
const server=createServer(async(req,res)=>{
 try{
  const origin='http://127.0.0.1:'+port,url=new URL(req.url,origin);
  if(req.headers.host!=='127.0.0.1:'+port){res.writeHead(400);res.end();return;}
  if(req.method==='GET'&&/^\/assets\/[a-zA-Z0-9_-]+\.(js|css)$/.test(url.pathname)){
   res.writeHead(200,{'Content-Type':url.pathname.endsWith('.css')?'text/css':'text/javascript','Cache-Control':'no-store'});
   res.end(await readFile(new URL('runtime/forms-dist'+url.pathname,import.meta.url)));return;
  }
  if(req.method==='GET'&&files[url.pathname]){
   const [file,type]=files[url.pathname];res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});
   res.end(await readFile(new URL(file,import.meta.url)));return;
  }
  if(req.method==='GET'&&url.pathname==='/fixture-token'){
   const actor=url.searchParams.get('actor');
   if(!Object.hasOwn(session,actor)){res.writeHead(400);res.end();return;}
   const token=await new SignJWT({role:'authenticated',session_id:session[actor]}).setSubject(nightFixture.sessions[actor]?.subject??actor)
    .setIssuer(issuer).setAudience('authenticated').setIssuedAt().setExpirationTime('2m')
    .setProtectedHeader({alg:'ES256',kid:jwk.kid}).sign(privateKey);
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({token}));return;
  }
  const request=new Request(url,{method:req.method,headers:req.headers,
   ...(req.method==='GET'||req.method==='HEAD'?{}:{body:Readable.toWeb(req),duplex:'half'})});
  const response=await handler(request);
  res.writeHead(response.status,Object.fromEntries(response.headers));
  res.end(await response.text());
 }catch{res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{code:'harness_unavailable'}}));}
});
server.listen(port,'127.0.0.1',()=>console.log('Fictional browser harness: http://127.0.0.1:'+port));
async function close(){await new Promise(resolve=>server.close(resolve));await db.close();process.exit();}
process.on('SIGINT',close);process.on('SIGTERM',close);
