'use client';
import type {InvoiceSourceGroup} from '../shared/invoice-source-groups';
const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
export function InvoiceSourceSummary({groups,selected,onChange,disabled,shown,selectedLines,hiddenSelections}:{groups:InvoiceSourceGroup[];selected:string;onChange:(key:string)=>void;disabled:boolean;shown:number;selectedLines:number;hiddenSelections:number}){
 const scoped=groups.filter(g=>!selected||g.key===selected),sum=(field:'netCents'|'recorded'|'unrecorded'|'conflicts'|'unchecked'|'matchingIssues'|'attention')=>scoped.reduce((n,g)=>n+g[field],0),lines=scoped.reduce((n,g)=>n+g.entries.length,0),mixed=scoped.filter(g=>g.dates.length>1);
 return <section className="food-card" aria-label="Invoice source summary"><h3>Review by supplier invoice</h3><label className="shared-field">Supplier invoice in this file<select value={selected} disabled={disabled} onChange={e=>onChange(e.target.value)}><option value="">All {groups.length} supplier invoices</option>{groups.map(g=><option value={g.key} key={g.key}>{g.vendor} · {g.invoiceNumber} · {g.entries.length} lines</option>)}</select></label>
 <p>Only source lines in this file are included. This is not the supplier’s full invoice total, a credit, a payment or booked expense. Tax, freight and lines missing from the file are not included. Different quantities and units are not added together.</p>
 <div className="food-summary"><span>Source lines<strong>{lines}</strong></span><span>File line subtotal, net USD<strong>{money(sum('netCents'))}</strong></span><span>Lines needing attention<strong>{sum('attention')}</strong></span></div>
 {scoped.length===1&&<p>Source invoice dates: {scoped[0].dates.join(', ')}.</p>}
 <p>{sum('recorded')} already recorded · {sum('unrecorded')} not recorded · {sum('conflicts')} with changed saved fields · {sum('unchecked')} not checked.</p><p>{sum('matchingIssues')} unrecorded lines need an item, pack or unit decision.</p>
 {mixed.length>0&&<p className="food-warning">{mixed.length} supplier invoice identities have conflicting dates in this file. Check the original source before saving; this review does not choose a date or correct the file. Their lines remain in Show lines needing attention.</p>}
 <p>{shown} lines match the current invoice and attention filters. Totals above include every line for the selected invoice, including rows hidden by the attention filter.</p>
 {selectedLines>0&&<p role="status">{selectedLines} lines are selected for the save group across this entire file. {hiddenSelections} selected lines are outside the current filters. Review the complete save-group list below before confirming. Changing filters does not clear selections.</p>}
 </section>;
}
