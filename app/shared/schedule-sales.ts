type Hours={scope:'restaurant'|'authorized departments'|'own schedule';publishedMinutes:number;plannedMinutes:number;draftMinutes:number};

// Explicit user-entered productivity scenarios have their own denominator.
// Saved access scope must not turn those inputs into a claimed schedule readout.
// This also works when a persisted turn is read back without its old context.
export function checkedHypotheticalScheduleScope(question:string,answer:string){
 if(!/\b(?:hypothetical|not live(?: restaurant)? data)\b/i.test(question)||!/\bsales per (?:published|planned) hour\b/i.test(question))return answer;
 if(/[€£¥]|\b(?:eur|gbp|cad|aud)\b|\b(?:labor|labour) (?:percentage|percent|cost|target)\b/i.test(question))return answer;
 const number='(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?';
 const salesValues=[...question.matchAll(new RegExp('\\$'+number+'\\s+weekly\\s+(?:sales|revenue)\\b','gi'))];
 const publishedValues=[...question.matchAll(new RegExp('\\b'+number+'\\s+published\\s+hours\\b','gi'))];
 const draftValues=[...question.matchAll(new RegExp('\\b'+number+'\\s+(?:additional\\s+)?draft\\s+hours\\b','gi'))];
 if(salesValues.length!==1||publishedValues.length!==1||draftValues.length!==1||/\$[\d,.]+\s*[-–—]|[-–—]\s*\$|\b\d+(?:\.\d+)?\s*[-–—]\s*\d+\s+(?:published|(?:additional )?draft) hours\b|[-–—]\s*\d[\d,.]*\s+(?:published|(?:additional )?draft) hours\b/.test(question))return answer;
 const [sales]=salesValues,[published]=publishedValues,[drafts]=draftValues;
 const amount=Number(sales[0].match(/[\d,.]+/)?.[0].replaceAll(',',''));
 const publishedHours=Number(published[0].match(/[\d,.]+/)?.[0].replaceAll(',',''));
 const draftHours=Number(drafts[0].match(/[\d,.]+/)?.[0].replaceAll(',',''));
 const plannedHours=publishedHours+draftHours;
 if(![amount,publishedHours,draftHours,plannedHours].every(Number.isFinite)||amount<=0||publishedHours<=0||draftHours<0||plannedHours<=0)return answer;
 const money=(value:number)=>value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
 return `Using only your hypothetical weekly inputs: $${money(amount)} sales, ${publishedHours} published hours and ${draftHours} additional draft hours. Planned hours are ${publishedHours} + ${draftHours} = ${plannedHours}.\n\nSales per published hour = $${money(amount)} ÷ ${publishedHours} = $${money(amount/publishedHours)}.\nSales per planned hour = $${money(amount)} ÷ ${plannedHours} = $${money(amount/plannedHours)}.\n\nPlanned includes the additional drafts, so its sales-per-hour figure is lower when drafts add hours. Drafts are not published hours. These quantities came from your question; they are not a readout of the saved GM schedule or verified whole-store data. A restricted saved schedule cannot establish whole-store hours. Compare sales and hours only for the same restaurant, week and department scope.\n\nThis is a productivity calculation, not a labor percentage or staffing decision. Chat does not save a forecast, publish drafts or change staffing.`;
}

// A narrow convenience for a single weekly-sales scenario stated in chat.
// Ambiguous amounts, ranges, other currencies and explicit labor budgets are
// left to clarification; this never saves a forecast or changes a schedule.
export function scheduleSalesCheck(question:string,hours:Hours){
 if(hours.scope!=='restaurant'||/\b(?:labor|labour|payroll)\s+(?:budget|target|spend|cost)\b|\bbudget\b|[€£¥]|\b(?:eur|gbp|cad|aud)\b/i.test(question))return null;
 const amounts=[...question.matchAll(/(?<![\w.,-])\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(k|thousand|m|million)?\b/gi)].filter(m=>m[0].includes('$')||m[3]);
 if(amounts.length!==1)return null;
 const found=amounts[0],before=question.slice(0,found.index),after=question.slice(found.index!+found[0].length);
 if(/[-–—]\s*\$?\s*$/.test(before)||/^\s*[-–—]/.test(after)||/^\s*(?:hours?|people|employees?|shifts?)\b/i.test(after))return null;
 const shorthand=/^\s*(?:sales\s+)?(?:a\s+|per\s+)?week\b/i.test(after),explicit=/\b(?:sales|revenue)\b/i.test(question)&&/\bweek(?:ly)?\b/i.test(question);
 if(!shorthand&&!explicit||!explicit&&/\b(?:labor|labour|payroll)\b/i.test(question))return null;
 const amount=Number(found[1].replaceAll(',','')+(found[2]??''))*({k:1000,thousand:1000,m:1000000,million:1000000}[found[3]?.toLowerCase()??'']??1);
 if(!Number.isFinite(amount)||amount<=0||amount>100000000)return null;
 const compare=(minutes:number)=>({scheduledHours:minutes/60,salesPerScheduledHour:minutes>0?Math.round(amount*60/minutes*100)/100:null});
 return {weeklySales:amount,currency:'USD',basis:'User-provided scenario for this answer only; not a saved or verified sales forecast',interpretation:explicit?'The user explicitly described weekly sales or revenue':'Assuming the restaurant shorthand means weekly sales; state this assumption in the answer, never call it a labor budget',published:compare(hours.publishedMinutes),plannedIncludingDrafts:compare(hours.plannedMinutes),includesDrafts:hours.draftMinutes>0,limits:['Scheduled hours are before breaks, not payroll hours or actual labor cost.','Sales per scheduled hour alone does not establish whether staffing is good. Compare to the restaurant target or its history.','An actual labor percentage also needs average hourly labor cost and a consistent definition of included payroll costs.']};
}
