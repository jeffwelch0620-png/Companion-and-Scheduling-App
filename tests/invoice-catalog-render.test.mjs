import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import fs from 'node:fs';
import ts from 'typescript';
import {parseFoodItem} from '../.sites-runtime/shared/food.mjs';
import {readInvoiceCsv,invoiceCsvColumns} from '../.sites-runtime/shared/food-invoice-csv.mjs';
fs.mkdirSync('.sites-runtime/team',{recursive:true});
for(const name of fs.readdirSync('app/team').filter(n=>/\.tsx?$/.test(n))){
 const code=ts.transpileModule(fs.readFileSync('app/team/'+name,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from '(\.{1,2}\/[^']+)'/g,"from '$1.mjs'").replace(/import '[^']+\.css';/g,'');
 fs.writeFileSync('.sites-runtime/team/'+name.replace(/\.tsx?$/,'.mjs'),code);
}
const {InvoiceForm}=await import('../.sites-runtime/team/food-invoice.mjs');
const {InvoiceCatalogPicker}=await import('../.sites-runtime/team/food-invoice-catalog.mjs');
const {FoodWorkspace}=await import('../.sites-runtime/team/food.mjs');
const {InvoiceBatchPanel,InvoiceBatchResults}=await import('../.sites-runtime/team/invoice-batch.mjs');
const me={id:'owner',locationId:'a',area:'Executive',capabilities:['location.manage'],qualifications:[]},w={location:{id:'a',name:'Fictional restaurant',timezone:'America/New_York'},me,members:[me],records:[]};
const csv=invoiceCsvColumns.join(',')+'\nFixture Supplier,007,INV-001,1,2026-01-01,2,supplier-pack,case,20.00';
const source={dataset:'demo',sourceRestaurantId:'test',label:'Fictional fixture',importedAt:'2026-01-01T12:00:00Z',importedBy:'owner'};
const r={id:'item',revision:3,kind:'fooditem',locationId:'a',data:parseFoodItem({restaurantId:'test',name:'Fixture ingredient',controlNumber:'TEST',purchaseUnit:'case',packCount:2,unitQty:1,unitUOM:'lb',vendorSkus:[{id:'s1',vendor:'Fixture Supplier',vendorSku:'007',purchaseUnit:'case',packCount:2,unitQty:1,unitUOM:'lb',available:true}]},source)};
const draft={itemId:r.id,itemRevision:r.revision,skuId:'s1',source:{kind:'csv',fileName:'fixture.csv',byteLength:Buffer.byteLength(csv),sha256:'a'.repeat(64),row:readInvoiceCsv(csv)[0]}};
test('selected catalog draft fills the existing invoice form without confirming or saving it',()=>{
 const html=renderToStaticMarkup(React.createElement(InvoiceForm,{r,w,draft,busy:false,send:()=>{throw Error('Render must not save')},onSaved(){}}));
 assert.match(html,/value="INV-001"/);assert.match(html,/<option value="s1" selected=""/);assert.match(html,/fixture.csv/);assert.match(html,/CSV record 2/);assert.match(html,/<button[^>]*disabled=""[^>]*>Save reviewed invoice line/);assert.doesNotMatch(html,/checked=""/);
});

test('single-item invoice source controls share the restaurant context without nesting a second form or preconfirming',()=>{
 const html=renderToStaticMarkup(React.createElement(InvoiceForm,{r,w,busy:false,apiRoot:'/scoped-api',send:()=>{throw Error('Render must not save')},onSaved(){}}));
 assert.equal((html.match(/<form\b/g)??[]).length,1);assert.match(html,/Browse archived CSVs/);assert.match(html,/Invoice CSV file/);assert.match(html,/after a separate confirmation/);assert.match(html,/leaves archived originals unchanged/);assert.doesNotMatch(html,/Original CSV archived as|checked=""/);
});
test('catalog picker explains bounded source review and saved-history limits',()=>{
 const html=renderToStaticMarkup(React.createElement(InvoiceCatalogPicker,{locationId:'a',dataset:'demo',apiRoot:'/api',disabled:true,onReset(){},onSelect(){throw Error('No selection during render')}}));
 assert.match(html,/250 lines/);assert.match(html,/256 KiB/);assert.match(html,/duplicate checks run when you save/);assert.match(html,/original file is not archived/);assert.match(html,/<input[^>]*disabled=""/);
});
test('only purchasers and owners see the catalog invoice entry point',()=>{
 const render=caps=>renderToStaticMarkup(React.createElement(FoodWorkspace,{w:{...w,me:{...me,capabilities:caps}},apiRoot:'/api',onBusy(){}}));
 assert.match(render(['location.manage']),/Match invoice CSV to items/);assert.match(render(['orders.review']),/Match invoice CSV to items/);assert.doesNotMatch(render(['tasks.manage']),/Match invoice CSV to items/);
});
const {InvoiceCatalogRow}=await import('../.sites-runtime/team/food-invoice-catalog.mjs');
const existing={entryKey:'fixture',itemId:'old-item',title:'Saved fixture item',controlNumber:'OLD',sequence:10,revision:3,invoiceDate:'2026-01-01',quantity:2,unitBasis:'supplier-pack',invoiceUnit:'case',lineTotalCents:2000,vendorSku:'007'};
const entry={row:draft.source.row,status:'ready',matches:[{itemId:r.id,itemRevision:r.revision,skuId:'s1',title:r.data.title,controlNumber:'TEST',label:'Fixture pack',unit:'case',quantity:2,price:10}]};
const rowHtml=saved=>renderToStaticMarkup(React.createElement(InvoiceCatalogRow,{entry:{...entry,saved},file:draft.source,disabled:false,onSelect(){throw Error('Render must not select')},onOpenSaved(){}}));
test('already recorded and changed source rows offer saved history without duplicate capture controls',()=>{
 let html=rowHtml({state:'recorded',differences:[],source:existing});assert.match(html,/Already recorded/);assert.match(html,/Saved fixture item/);assert.match(html,/Open saved invoice history/);assert.doesNotMatch(html,/Review this item and line/);
 html=rowHtml({state:'conflict',differences:['quantity','net line amount'],source:existing});assert.match(html,/Saved source differs/);assert.match(html,/quantity, net line amount/);assert.doesNotMatch(html,/Review this item and line/);
});
test('unchecked saved history fails closed while unrecorded source retains explicit item choice',()=>{
 assert.doesNotMatch(rowHtml({state:'unchecked',differences:[]}),/Review this item and line/);assert.match(rowHtml({state:'unchecked',differences:[]}),/Refresh before choosing/);
 assert.match(rowHtml({state:'not-recorded',differences:[]}),/Review this item and line/);
});

const {InvoiceArchiveSave,InvoiceArchiveDownload}=await import('../.sites-runtime/team/invoice-archive.mjs');
test('original-file archive requires explicit confirmation and does not claim completion before response',()=>{
 const html=renderToStaticMarkup(React.createElement(InvoiceArchiveSave,{apiRoot:'/api',locationId:'a',dataset:'operating',csv,file:draft.source,disabled:false}));
 assert.match(html,/entire file/);assert.match(html,/operating/);assert.match(html,/<button[^>]*disabled=""[^>]*>Archive original CSV/);assert.doesNotMatch(html,/Original CSV archived as/);assert.doesNotMatch(html,/checked=""/);
});
test('saved history checks for an archive before offering a download',()=>{
 const html=renderToStaticMarkup(React.createElement(InvoiceArchiveDownload,{apiRoot:'/api',locationId:'a',dataset:'demo',source:draft.source}));
 assert.match(html,/Find archived original CSV/);assert.doesNotMatch(html,/Download archived CSV/);
});

const {InvoiceArchivePage}=await import('../.sites-runtime/team/invoice-archive-browser.mjs');
const archived={sha256:'a'.repeat(64),fileName:'Fictional <source>.csv',byteLength:200,rowCount:2,createdAt:'2026-01-01T12:00:00Z'};
test('archive page shows usage, escaped names, scoped download and explicit resume controls',()=>{
 const page={locationId:'a',dataset:'demo',q:'',files:[archived],next:null,totals:{files:1,bytes:200,matched:1},limits:{files:10000,bytes:104857600}};
 const html=renderToStaticMarkup(React.createElement(InvoiceArchivePage,{page,apiRoot:'/api',disabled:true,onResume(){throw Error('No resume during render')}}));
 assert.match(html,/1 files/);assert.match(html,/100 MiB/);assert.match(html,/Fictional &lt;source&gt;.csv/);assert.match(html,/<button[^>]*disabled=""[^>]*>Open for invoice review/);assert.match(html,/locationId=a&amp;dataset=demo/);assert.match(html,/download=1/);assert.doesNotMatch(html,/Archive original CSV|Save reviewed invoice line/);
 const full=renderToStaticMarkup(React.createElement(InvoiceArchivePage,{page:{...page,files:[],totals:{files:10000,bytes:104857600,matched:0}},apiRoot:'/api',disabled:false,onResume(){}}));
 assert.match(full,/Archive capacity reached/);assert.match(full,/No archived CSVs/);assert.doesNotMatch(full,/Open for invoice review/);
});
test('verified reopened archive displays its saved original without asking for another upload',()=>{
 const html=renderToStaticMarkup(React.createElement(InvoiceArchiveSave,{apiRoot:'/api',locationId:'a',dataset:'demo',csv,file:draft.source,disabled:false,archived}));
 assert.match(html,/Original CSV archived as/);assert.match(html,/Download archived CSV/);assert.doesNotMatch(html,/type="checkbox"|>Archive original CSV</);
});
test('group review shows chosen source and USD total without preconfirmation or sending during render',()=>{
 const review={locationId:'a',dataset:'demo',entries:[{...entry,saved:{state:'not-recorded',differences:[]}}]},choices=[{recordNumber:2,itemId:'item',skuId:'s1'}];
 const html=renderToStaticMarkup(React.createElement(InvoiceBatchPanel,{review,file:draft.source,choices,apiRoot:'/api',disabled:false,onBusy(){throw Error('Render may not lock or save')},onStarted(){},onChanged(){}}));
 assert.match(html,/1 selected/);assert.match(html,/20.00 net USD/);assert.match(html,/up to 25/);assert.match(html,/Each line is saved separately/);assert.match(html,/<button disabled="">Save selected reviewed lines/);assert.doesNotMatch(html,/checked=""/);
});
test('only an explicitly chosen compatible pack is selected for a group',()=>{
 const html=renderToStaticMarkup(React.createElement(InvoiceCatalogRow,{entry:{...entry,saved:{state:'not-recorded',differences:[]}},file:draft.source,disabled:false,choice:{recordNumber:2,itemId:'item',skuId:'s1'},onChoose(){},onSelect(){}}));
 assert.match(html,/Choose this item and pack for the group/);assert.match(html,/checked=""/);
 const blocked=renderToStaticMarkup(React.createElement(InvoiceCatalogRow,{entry:{...entry,saved:{state:'recorded',source:existing,differences:[]}},file:draft.source,disabled:false,onChoose(){},onSelect(){}}));
 assert.doesNotMatch(blocked,/Choose this item and pack for the group/);
});
test('group results distinguish confirmed, uncertain, rejected and unsent rows',()=>{
 const lines=['saved','uncertain','rejected','queued'].map((state,i)=>({row:{...entry.row,recordNumber:i+2},match:entry.matches[0],state,message:state==='uncertain'?'This line may already be saved.':undefined}));
 const html=renderToStaticMarkup(React.createElement(InvoiceBatchResults,{batch:{lines},running:false}));
 assert.match(html,/1 of 4 lines confirmed saved/);assert.match(html,/Save not confirmed/);assert.match(html,/Needs review/);assert.match(html,/Not sent/);assert.match(html,/may already be saved/);
});
