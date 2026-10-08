import type {ChatSource} from './companion-chat-types';
import {localDate} from './local-time';

type Item={title:string;quantity:number;unit:string;targetDate:string;track:string};
type Facts={items:Item[];manager?:unknown;managerName?:unknown;managerLabel?:unknown;assignedManager?:unknown};
const numberWords:Record<string,number>={zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
function actualQuantity(question:string){
 const match=question.match(/\b(?:made|produced|finished|completed|tell you|record|report|enter)\s+(?:only\s+)?(?:actual(?: quantity)?\s*(?:of|is|=)?\s*)?(zero|one|two|three|four|five|six|seven|eight|nine|ten|\d+(?:\.\d+)?)\b/i);
 if(!match)return null;
 const token=match[1].toLowerCase(),value=numberWords[token]??Number(token);
 return Number.isFinite(value)&&value>=0?value:null;
}
function managerLabel(prep:Facts){
 for(const value of [prep.managerLabel,prep.managerName,prep.manager,prep.assignedManager]){
   if(typeof value==='string'&&value.trim())return value.trim();
   if(value&&typeof value==='object'&&'name' in value&&typeof value.name==='string'&&value.name.trim())return value.name.trim();
 }
 return 'your assigned manager';
}
function namedItem(items:Item[],question:string){
 const text=question.toLowerCase(),matches=items.filter(item=>text.includes(item.title.toLowerCase()));
 if(matches.length===1)return matches[0];
 if(matches.length>1){
   const longest=[...matches].sort((a,b)=>b.title.length-a.title.length)[0];
   if(matches.filter(item=>item.title===longest.title).length===1&&matches.every(item=>longest.title.toLowerCase().includes(item.title.toLowerCase())))return longest;
   return null;
 }
 return items.length===1?items[0]:null;
}

// This only reads the current, cited personal prep projection. It neither
// retrieves other workers' work nor infers a completed report from chat.
export function checkedPrepHelp(context:Record<string,unknown>,sources:ChatSource[],question:string,answer:string):string{
 const prep=context.assignedPrep as Facts|undefined;
 if(!prep||!Array.isArray(prep.items)||!Array.isArray(context.evidence))return answer;
 const current=context.evidence.some(e=>{
   if(!e||typeof e!=='object'||!('source' in e)||!('facts' in e))return false;
   const source=e.source as ChatSource,facts=e.facts as Facts;
   return source?.kind==='food-prep'&&sources.some(s=>s.kind==='food-prep'&&s.id===source.id&&s.revision===source.revision)&&JSON.stringify(facts?.items)===JSON.stringify(prep.items);
 });
 if(!current)return answer;
 const items=prep.items.filter(item=>item&&typeof item.title==='string'&&typeof item.unit==='string'&&Number.isFinite(item.quantity)&&item.quantity>=0&&/^\d{4}-\d{2}-\d{2}$/.test(item.targetDate)),manager=managerLabel(prep);
 // An empty personal list is not another worker's prep assignment. Preserve
 // the caller's contextual answer instead of offering nonexistent controls
 // or assuming they have an assigned manager from their displayed position.
 if(!items.length)return answer;
 const futurePriority=/\btomorrow(?:’s|'s)?\b/i.test(question)&&/\b(now|today|first)\b/i.test(question)&&/\b(need|must|should|have to|do i)\b/i.test(question);
 if(futurePriority){
   if(typeof context.asOf!=='string'||typeof context.timezone!=='string')return answer;
   let today:string;
   try{today=localDate(context.asOf,context.timezone);}catch{return answer;}
   const tomorrowDate=new Date(today+'T12:00:00Z');tomorrowDate.setUTCDate(tomorrowDate.getUTCDate()+1);
   if(!Number.isFinite(tomorrowDate.getTime()))return answer;
   const tomorrow=tomorrowDate.toISOString().slice(0,10),describe=(date:string)=>items.filter(item=>item.targetDate===date).map(item=>`${item.title} — ${item.quantity} ${item.unit}${item.track?' ('+item.track+')':''}`).join('; ');
   return `The released date alone does not tell you to start tomorrow’s prep now or change today’s priority.\n\nToday (${today}): ${describe(today)||'No unfinished released item for this date is supplied here; that does not prove all restaurant prep is complete.'}\nTomorrow (${tomorrow}): ${describe(tomorrow)||'No released item for this date is supplied here.'}\n\nWork on today’s unfinished released prep unless ${manager} directs a different order. Before bringing tomorrow’s work forward, ask ${manager} to confirm the priority and current instructions. Keep each report on its actual assignment and production date. Chat does not change or release a prep list.`;
 }
 const earlierIssue=/\byesterday\b/i.test(question)&&/\b(recorded|reported)\b/i.test(question)&&/\b(ingredient|shortage)\b/i.test(question)&&/\btoday\b/i.test(question);
 const resolution=/\b(shortage|ingredient|prep problem)\b/i.test(question)&&/\b(fixed|resolved|handled|remedied|sorted|resolution)\b/i.test(question);
 if(resolution){
   const earlier=/\byesterday\b/i.test(question)?'yesterday’s reported actual result':'any earlier actual report';
   return `A shortage report does not prove the prep problem was fixed. The supplied current prep list does not show a verified manager resolution of the reported issue.\n\nAsk ${manager} directly whether the ingredient is available, whether replacement prep or another approved plan is needed, and what remaining service need you should cover. Use the refreshed Your assigned prep list for today’s released work; keep ${earlier} separate. Do not repeat a completion or inventory posting merely because the old line is absent.\n\nChat does not save a report, notify the manager, send this conversation, resolve the shortage or change inventory.`;
 }
 if(earlierIssue){
   const list=items.map(item=>`${item.targetDate}: ${item.title} — ${item.quantity} ${item.unit}${item.track?' ('+item.track+')':''}`).join('\n');
   return `Open the refreshed Your assigned prep list in My day or your role home. The current released items supplied here are:\n${list||'No unfinished released item is supplied here; that does not prove the restaurant has no prep need.'}\n\nKeep yesterday’s reported actual quantity and shortage separate from these current assignments. Ask ${manager} directly whether the ingredient is now available, whether replacement prep is needed, and what remaining service need to cover. A missing old line does not prove the shortage was resolved. Chat does not save a report, notify the manager, send this conversation or change inventory.`;
 }
 const actual=actualQuantity(question),reportQuestion=/\b(record|report|enter|log|save|recorded|mark)\b/i.test(question);
 const prepReport=/\b(prep|ranch|dressing|shortage|ingredient|made|produced|zero)\b/i.test(question)||items.some(item=>question.toLowerCase().includes(item.title.toLowerCase()));
 if(actual===null||!reportQuestion||!prepReport)return answer;
 const item=namedItem(items,question);
 if(item&&actual>=item.quantity)return answer;
 const selection=item?`select ${item.title} dated ${item.targetDate}`:'select the item you actually worked on; I cannot choose among multiple released lines from this question';
 const result=item?`Enter actual quantity ${actual} in its ${item.unit} unit. The released amount is ${item.quantity} ${item.unit}, so the production shortfall is ${Math.round((item.quantity-actual)*10000)/10000} ${item.unit}.`:`Enter actual quantity ${actual} in that selected item’s listed unit. Keep its released target separate from what you actually made.`;
 const reason=/\bingredient\b/i.test(question)&&/\b(unavailable|missing|out of)\b/i.test(question)?'Include the ingredient-unavailable reason you reported.':'Include the factual reason for the difference; do not invent a cause.';
 return `Open Your assigned prep in My day or your role home and ${selection}. ${result}\n\nSave the actual completion report with a truthful shortage/difference note. ${reason}${actual===0?' Recording actual zero is a valid report of zero production; it does not mean the planned amount was made.':''} A note alone is not a substitute for the actual quantity field.\n\nTell ${manager} directly about the shortage and confirm ingredient availability, any approved replacement prep, and what remaining service need or work to cover.\n\nChat does not save completion, notify the manager, send this conversation or post inventory. Do not record the planned amount as actual or post the same production again elsewhere.`;
}
