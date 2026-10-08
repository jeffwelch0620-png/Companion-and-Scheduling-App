type UserQuestion={question:string};
const numbers:Record<string,number>={zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
const amount='(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|\\d+(?:\\.\\d+)?)';
const container='(?:vessels?|containers?|batches?)';
const quantity=(token:string)=>numbers[token.toLowerCase()]??Number(token);
const rounded=(value:number)=>Math.round(value*10000)/10000;
const singular=(unit:string)=>unit.toLowerCase().startsWith('batch')?'batch':unit.toLowerCase().replace(/s$/,'');

export const stockAssumptionInstructions='An earlier on-hand observation plus reported production is not a current inventory balance. Consumption, waste, receipts and transfers may intervene. Keep released quantity minus reported production as a production shortfall, and current usable stock as unknown until a new count or an explicitly reconciled movement balance is supplied. State user-provided quantities as reports, not verified stock. A hypothetical opening count plus production calculation requires an explicit no-movement/no-consumption assumption and must remain labeled hypothetical. A stock count or reconciled on-hand balance belongs in the authorized stock-count workflow, never in Your assigned prep actual quantity: that field records only food actually made for the dated production assignment, including zero and truthful shortage reasons. For a manager, confirm usable count, movements, ingredient availability and service needs with BOH/FOH, then decide an approved replacement or urgent prep priority; do not invent stock, assignments, permissions or actions.';

function putsStockInProduction(sentence:string){
 if(!/\b(?:stock|inventory|on[ -]hand|counts?|counted|recount|movement balance)\b/i.test(sentence))return false;
 if(!/\b(?:Your assigned prep|prep (?:actual(?: quantity)?|completion)|actual (?:prep|production) (?:quantity|completion))\b/i.test(sentence))return false;
 if(!/\b(?:record|enter|save|put|submit)\b/i.test(sentence))return false;
 // A prohibition or an explicitly made-quantity instruction is already the
 // right boundary, even if the same sentence also discusses a stock count.
 if(/\b(?:do not|don't|never|must not|cannot)\b[^.!?\n]{0,80}\b(?:record|enter|save|put|submit)\b/i.test(sentence))return false;
 if(/\b(?:record|enter|save|put|submit)\b[^.!?\n]{0,100}\b(?:made|produced|actually prepared|production output)\b/i.test(sentence))return false;
 return true;
}

function separateCountRecording(question:string,answer:string){
 if(!/\b(?:stock|inventory|on[ -]hand|counts?|counted|recount|observation|movement)\b/i.test(question))return null;
 const sentences=answer.match(/[^.!?\n]+(?:[.!?]+|$)/g)??[];
 if(!sentences.some(putsStockInProduction))return null;
 const retained=sentences.filter(s=>!putsStockInProduction(s)).map(s=>s.trim()).filter(Boolean).join(' ');
 return `${retained}${retained?'\n\n':''}Record a physical usable-stock count or a reconciled on-hand balance only in the authorized stock-count workflow. Ask the responsible manager where to record it if that workflow is not available to you.\n\nYour assigned prep actual quantity records only food actually made for that dated production assignment, including actual zero and a truthful shortage/difference reason. Never put counted on-hand stock into that production field. A count does not establish a new batch, resolve a production shortfall or authorize duplicate posting. Chat does not save either record or change inventory.`;
}

function reportedRun(question:string){
 if(!/\b(?:on hand|opening count|earlier count|working observation)\b/i.test(question)||!/\b(?:prep|production|cook|dressing|ranch)\b/i.test(question))return null;
 const released=question.match(new RegExp('\\breleased\\s+('+amount+')\\s+('+container+')\\b','i'));
 const produced=question.match(new RegExp('\\b(?:reports?|reported|made|produced|completed)\\s+(?:only\\s+)?('+amount+')\\s+('+container+')\\b','i'));
 if(!released||!produced)return null;
 const unit=singular(released[2]);
 if(unit!==singular(produced[2]))return null;
 const target=quantity(released[1]),actual=quantity(produced[1]);
 if(!Number.isFinite(target)||!Number.isFinite(actual)||target<0||actual<0)return null;
 const capacity=question.match(new RegExp('\\b('+amount+')[ -]gallons?\\b','i'));
 return {target,actual,unit,capacity:capacity?quantity(capacity[1]):null};
}

function claimsDerivedStock(answer:string){
 const numericUnit=new RegExp('\\b'+amount+'[ -]'+container+'\\b','i');
 return answer.split(/[.!?\n]/).some(sentence=>{
   if(!numericUnit.test(sentence)&&!new RegExp('\\b'+amount+'\\s*\\+\\s*'+amount+'\\s*=','i').test(sentence))return false;
   return /\b(?:par|on hand|inventory|stock|overall|effectively)\b/i.test(sentence)&&/\b(?:short|shortfall|below|at|have|equals?|is|are|effectively)\b|\+/i.test(sentence)
     &&!/\b(?:production|released?|run)\s+(?:shortfall|shortage)\b/i.test(sentence);
 });
}

// This guard uses only explicitly stated user quantities. It cannot retrieve,
// reconcile or post inventory, and never treats an assistant claim as evidence.
export function checkedStockAssumptions(context:Record<string,unknown>,question:string,answer:string,history:UserQuestion[]=[]):string{
 if(context.product!=='workforce')return answer;
 if(/\bsame\s+batch\b/i.test(question)&&/\b(?:again|twice|duplicate)\b/i.test(question)&&/\b(?:add|post|record|inventory|stock)\b/i.test(question))return 'No. Do not post or add the same production batch twice. Released prep, chat arithmetic and a fresh stock count do not authorize a duplicate production event. A count measures on-hand stock; recording a genuinely new batch or correcting an earlier erroneous event is a separate authorized operation. This chat does not post production or change inventory. Ask the responsible manager to reconcile the recorded batch and current stock without duplicating it.';
 const separated=separateCountRecording(question,answer);
 if(separated)return separated;
 const direct=reportedRun(question);
 const practicalShortage=!!direct&&/\b(?:shortage|shortfall|ran short)\b/i.test(question)&&/\b(?:first|next step|what should i do|what do i do)\b/i.test(question);
 if(!claimsDerivedStock(answer)&&!practicalShortage)return answer;
 const explicitRecount=/\b(?:i|we)\s+(?:have\s+)?(?:just\s+)?(?:physically\s+)?(?:recounted|re-counted)\b/i.test(question);
 const boundedScenario=/\b(?:assuming|assume|if)\b[^.!?\n]{0,100}\bno\s+(?:stock|inventory)\s+(?:movements?|changes?)\b/i.test(answer);
 if(explicitRecount||boundedScenario)return answer;
 // Follow-ups about this prep issue may use the earlier user report. Never
 // borrow unrelated reports for a new station, date or topic.
 const followup=/\b(?:prep plan|the shortage|ranch)\b/i.test(question)&&/\b(?:completed|resolved|inventory|par|vessels?|Toast)\b/i.test(question)&&!/\b(?:tomorrow|yesterday|next week|different|another|new batch)\b/i.test(question);
 const run=direct??(followup?[...history].reverse().map(t=>reportedRun(t.question)).find(Boolean):null);
 if(!run&&!followup)return answer;
 let production='The current question and retained user reports do not supply both released and reported production quantities for this calculation. I cannot calculate a production shortfall from completed status or an invented stock balance.';
 if(run){
   const difference=rounded(Math.max(0,run.target-run.actual)),plural=(n:number)=>run.unit+(n===1?'':run.unit==='batch'?'es':'s');
   const volume=run.capacity===null?'':` (${rounded(difference*run.capacity)} gallons using your stated ${run.capacity}-gallon ${run.unit} unit)`;
   production=`Using your reported production quantities: ${run.target} ${plural(run.target)} released minus ${run.actual} ${plural(run.actual)} reported made means a production shortfall of ${difference} ${plural(difference)}${volume}. This is reported production, not a verified inventory balance.`;
 }
 const completion=/\b(?:completed|resolved|back at)\b/i.test(question)&&!direct?'A completed prep-plan status does not establish shortage resolution or current stock.\n\n':'';
 const toast=/\bToast\b/i.test(question)?' Chat cannot mark the item unavailable in Toast; any availability change remains a separate authorized manager action.':'';
 return `${completion}${production}\n\nCurrent usable stock and the current gap to par are unknown. Do not add an earlier on-hand observation to reported production and call that current inventory: use, waste, receipts or transfers may have occurred. Physically recount usable stock and reconcile movements since the observation.\n\nFor the immediate priority, confirm that count, ingredient availability and remaining service needs with BOH and FOH. Have the responsible manager decide the approved replacement or urgent prep priority, name who will handle it and confirm the result. Keep the production-shortage report separate from the new stock count; do not post the same production again.\n\nChat does not inspect stock, save completion, resolve the shortage, change inventory or grant permissions.${toast}`;
}
