// Fictional source only, in the existing ephemeral local preview database.
export async function seedInvoiceColumnMapPreview(dispatch){
 const csv='\uFEFFSupplier,SKU,Invoice,Line,Date,Qty,Basis,Unit,Net,Description\r\nDemo Foods,DF-1001,DEMO-MAPPED-1,01,2026-09-29,2,supplier-pack,case,20.00,"Fictional source, first line"\r\nDemo Foods,DF-1001,DEMO-MAPPED-1,02,2026-09-29,1,supplier-pack,case,10.00,Fictional second line\r\n';
 const keys=['vendor','vendor_sku','invoice_number','line_reference','invoice_date','quantity','unit_basis','invoice_unit','line_total'];
 const layout={version:1,headers:csv.replace(/^\uFEFF/,'').split('\r\n')[0].split(','),fields:Object.fromEntries(keys.map((key,i)=>[key,i]))};
 const sha256=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(csv))).toString('hex');
 const response=await dispatch('http://localhost/api/food/invoice-files',{method:'POST',headers:{'oai-authenticated-user-id':'admin-fixture','oai-authenticated-user-email':'admin@example.test',Origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify({locationId:'berts',dataset:'demo',csv,fileName:'Fictional mapped supplier invoice.csv',byteLength:Buffer.byteLength(csv),sha256,layout,confirmed:true})});
 if(!response.ok)throw Error('Fictional mapped invoice seed failed '+response.status);
}
