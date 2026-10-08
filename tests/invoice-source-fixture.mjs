import {invoiceCsvColumns,readInvoiceCsv} from '../.sites-runtime/shared/food-invoice-csv.mjs';
export async function seedInvoiceSourceFixture(dispatch){
 const lines=[...Array.from({length:25},(_,i)=>`Demo Foods,DF-1001,DEMO-A,${i+1},2026-09-29,1,supplier-pack,case,${i===24?'0.00':'10.00'}`),'Demo Foods,DF-2002,DEMO-B,1,2026-09-28,1,supplier-pack,case,20.00','Demo Foods,DF-2002,DEMO-B,2,2026-09-29,1,supplier-pack,case,20.00','Demo Foods,UNKNOWN,DEMO-C,1,2026-09-29,1,supplier-pack,case,7.00','Other Demo Supplier,DF-1001,DEMO-A,1,2026-09-29,1,supplier-pack,case,5.00'];
 const csv=invoiceCsvColumns.join(',')+'\n'+lines.join('\n'),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(csv))).toString('hex');
 const headers={'oai-authenticated-user-id':'admin-fixture','oai-authenticated-user-email':'admin@example.test',Origin:'http://localhost','Content-Type':'application/json'};
 const post=async(url,body)=>{const r=await dispatch('http://localhost'+url,{method:'POST',headers,body:JSON.stringify(body)});if(!r.ok)throw Error('Fictional invoice seed failed '+r.status);return r.json()};
 const file={kind:'csv',fileName:'Fictional multi-invoice review.csv',byteLength:Buffer.byteLength(csv),sha256};
 await post('/api/food/invoice-files',{locationId:'berts',dataset:'demo',...file,csv,confirmed:true,kind:undefined});
 const row=readInvoiceCsv(csv)[0];
 await post('/api/food',{locationId:'berts',requestId:'fictional-source-first-row',action:'fooditem.invoice',recordId:'demo-food-WI-001',expectedRevision:1,input:{...row,skuId:'vs_demo1',sourceNote:'Fictional source review fixture only',confirmed:true,fileSource:{...file,row}}});
}
