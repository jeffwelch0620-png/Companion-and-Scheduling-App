import test from 'node:test';import assert from 'node:assert/strict';
import {inspectInvoiceCsv,readInvoiceCsv,parseInvoiceCsvLayout,parseInvoiceFileSource,invoiceCsvColumns} from '../.sites-runtime/shared/food-invoice-csv.mjs';
import {readInvoiceUpload,invoiceCsvNeedsMapping,applyInvoiceCsvLayout} from '../.sites-runtime/shared/invoice-csv-source.mjs';
import {csvDigest,parseInvoiceArchive,verifyArchivedInvoiceSource} from '../.sites-runtime/shared/invoice-archive.mjs';
import {resumeInvoiceArchive} from '../.sites-runtime/shared/invoice-archive-resume.mjs';
export const csv='\uFEFFProduct code,Line,Delivered,Net amount,Description\r\n001,01,2,20.00,"Fictional, café"\r\n\r\n002,02,3,30.00,"Other ""quoted"" item"\r\n';
export const layout=()=>({version:1,headers:inspectInvoiceCsv(csv).headers,fields:{vendor:{literal:'Fixture Supplier'},vendor_sku:0,invoice_number:{literal:'INV-001'},line_reference:1,invoice_date:{literal:'2026-01-01'},quantity:2,unit_basis:{literal:'supplier-pack'},invoice_unit:{literal:'case'},line_total:3}});
const upload=(body=csv)=>({name:'Fictional supplier.csv',size:Buffer.byteLength(body),arrayBuffer:async()=>new TextEncoder().encode(body).buffer});
test('explicit mapping preserves original IDs, record positions, excluded columns and original byte identity',async()=>{
 const source=await readInvoiceUpload(upload(),true),before=structuredClone(source);assert.equal(invoiceCsvNeedsMapping(source),true);
 const mapped=applyInvoiceCsvLayout(source,layout()),rows=readInvoiceCsv(mapped.csv,mapped.file.layout);
 assert.deepEqual(source,before);assert.equal(mapped.csv,csv);assert.equal(mapped.file.sha256,await csvDigest(csv));assert.equal(invoiceCsvNeedsMapping(mapped),false);
 assert.deepEqual(rows.map(r=>[r.recordNumber,r.vendorSku,r.lineReference,r.lineTotal]),[[2,'001','01','20.00'],[4,'002','02','30.00']]);
 assert.equal(mapped.file.layout.headers.at(-1),'Description');assert.equal(mapped.file.layout.fields.vendor.literal,'Fixture Supplier');
 await assert.rejects(()=>readInvoiceUpload(upload()));
});
test('mapping forbids missing, extra, duplicate, fractional and out-of-range column choices',()=>{
 for(const modify of [l=>delete l.fields.quantity,l=>l.fields.extra=1,l=>l.fields.quantity=0,l=>l.fields.quantity=-1,l=>l.fields.quantity=40,l=>l.fields.quantity=1.1,l=>l.version=2,l=>l.headers=['A',' a '],l=>l.fields.quantity={literal:'2'},l=>l.fields.vendor={literal:'X',extra:true},l=>l.fields.vendor={literal:''},l=>l.extra=true]){const l=layout();modify(l);assert.throws(()=>parseInvoiceCsvLayout(l));}
});
test('mapped rows reject ambiguous dates, decimal formats, credit values and duplicate identities',()=>{
 const badDate=layout();badDate.fields.invoice_date={literal:'01/02/2026'};assert.throws(()=>readInvoiceCsv(csv,badDate));
 const badBasis=layout();badBasis.fields.unit_basis={literal:'case'};assert.throws(()=>readInvoiceCsv(csv,badBasis));
 for(const body of [csv.replace('20.00','$20.00'),csv.replace('20.00','-20.00'),csv.replace('2,20.00','2e2,20.00'),csv.replace('3,30.00','"1,000",30.00'),csv.replace('002,02','002,01')])assert.throws(()=>readInvoiceCsv(body,layout()));
});
test('raw inspection bounds records and headings and rejects ragged or malformed supplier exports',()=>{
 for(const body of ['A,A\n1,2','A,\n1,2','A,B\n1','A,B\n1,2,3','A\n"open','A\n"closed" trailing',Array.from({length:41},(_,i)=>'H'+i).join(',')+'\n'+Array(41).fill('x').join(','),'A\n'+Array(251).fill('x').join('\n'),'A\n'+('x'.repeat(256*1024))])assert.throws(()=>inspectInvoiceCsv(body));
});
test('changed headings require a new mapping and standard templates retain their existing behavior',async()=>{
 assert.throws(()=>readInvoiceCsv(csv.replace('Product code','SKU'),layout()),/headings changed/);
 const standard=invoiceCsvColumns.join(',')+'\nFixture Supplier,001,INV-001,01,2026-01-01,2,supplier-pack,case,20.00';
 const source=await readInvoiceUpload(upload(standard),true);assert.equal(invoiceCsvNeedsMapping(source),false);assert.equal(source.file.layout,undefined);assert.equal(readInvoiceCsv(standard)[0].vendorSku,'001');
});
test('mapped archives retain exact bytes and reopening demands a fresh column review',async()=>{
 const mapped=applyInvoiceCsvLayout(await readInvoiceUpload(upload(),true),layout());
 const archived=await parseInvoiceArchive({...mapped.file,csv,confirmed:true});assert.equal(archived.csv,csv);assert.equal(archived.rowCount,2);
 const metadata={...archived,createdAt:'2026-09-30T14:30:00Z'};
 await assert.rejects(()=>resumeInvoiceArchive(new Response(new TextEncoder().encode(csv)),metadata));
 const reopened=await resumeInvoiceArchive(new Response(new TextEncoder().encode(csv)),metadata,true);assert.equal(reopened.csv,csv);assert.equal(reopened.file.layout,undefined);assert.equal(invoiceCsvNeedsMapping(reopened),true);
 await assert.rejects(()=>parseInvoiceArchive({...mapped.file,csv,confirmed:false}));
 await assert.rejects(()=>resumeInvoiceArchive(new Response(new TextEncoder().encode(csv)),{...metadata,rowCount:3},true));
});
test('mapped source capture retains checked mapping and must match its archived original',async()=>{
 const source=applyInvoiceCsvLayout(await readInvoiceUpload(upload(),true),layout()),row=readInvoiceCsv(csv,layout())[0];
 const provenance=parseInvoiceFileSource({...source.file,row},row,{vendor:'Fixture Supplier',vendorSku:'001'});
 assert.deepEqual(provenance.layout,layout());
 const db=record=>({prepare:()=>({bind:()=>({first:async()=>record})})});
 await assert.rejects(()=>verifyArchivedInvoiceSource(db(null),'a','demo',provenance),/Archive the original/);
 await verifyArchivedInvoiceSource(db({csv,byteLength:Buffer.byteLength(csv)}),'a','demo',provenance);
 await assert.rejects(()=>verifyArchivedInvoiceSource(db({csv,byteLength:Buffer.byteLength(csv)}),'a','demo',{...provenance,row:{...row,lineTotal:'25.00'}}),/differs/);
 await assert.rejects(()=>verifyArchivedInvoiceSource(db({csv:csv.replace('20.00','21.00'),byteLength:Buffer.byteLength(csv)}),'a','demo',provenance),/integrity/);
});
