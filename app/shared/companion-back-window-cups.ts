import type {ChatSource} from './companion-chat-types';

type Evidence={source:ChatSource;facts:unknown};
type Pan='deep-half'|'sixth';
type Component={item:string;container:Pan;panCount:number;cupsPerPan:number;estimatedCups:number};
type Capacity={container:Pan;referencePans:number;referenceCups:number;cupsPerPan:number;sourceId:string};
export type BackWindowCupCalculation={status:'ready';authority:'calculation from current approved guide and user-reported pan quantities';sources:ChatSource[];capacities:Capacity[];components:Component[];estimatedTotalCups:number;estimated:true;limits:string[]}|{status:'needs-review';reasons:string[];sources:ChatSource[]};
const names='ranch|honey mustard|brown sugar|french|italian|thousand island|coleslaw|tartar';
const quantity='one and a half|half a|half|quarter|another|an|a|zero|no|one|two|three|four|five|six|seven|eight|nine|ten|[-+]?\\d+(?:\\.\\d+)?';
const number=(text:string)=>({zero:0,no:0,a:1,an:1,another:1,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,half:0.5,'half a':0.5,quarter:0.25,'one and a half':1.5} as Record<string,number>)[text.toLowerCase()]??Number(text);
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const finite=(value:number)=>Number.isFinite(value)&&value>=0&&value<=Number.MAX_SAFE_INTEGER;
function approvedBackWindowText(entry:Evidence):string|null{
 const facts=object(entry.facts),guide=object(facts.guide);
 if(entry.source.kind!=='standard'||facts.authority!=='approved standard'||facts.instructionContentOmitted||facts.methodAvailable===false||![facts.zone,facts.position].some(v=>typeof v==='string'&&/^back window$/i.test(v))||!Array.isArray(guide.steps)||!guide.steps.length)return null;
 const text=[...(Array.isArray(guide.preparation)?guide.preparation:[]),...guide.steps].filter(v=>typeof v==='string').join('\n');
 return /\bready\s+cups\b/i.test(text)?text:null;
}

/** Full reference-list requests use the current approved preparation text.
 * Copying the explicit vessel and cup reference together prevents a model from
 * relabelling a two-pan par as one pan's capacity. No catalog fallback, yield
 * conversion, usage forecast or production quantity is inferred. */
export function companionBackWindowCupReferences(question:string,evidence:readonly Evidence[]):{answer:string;sources:ChatSource[]}|null{
 if(!/\b(?:all|each|every|eight|8)\b/i.test(question)||!/\b(?:portion\s+sizes?|cup\s+sizes?|reference\s+pars?|pars)\b/i.test(question))return null;
 const approved=evidence.filter(e=>approvedBackWindowText(e));
 if(!approved.length)return null;
 const candidates=approved.map(e=>{
  const g=object(object(e.facts).guide),preparation=Array.isArray(g.preparation)?g.preparation.filter((v:unknown):v is string=>typeof v==='string'):[];
  const portion=preparation.filter(v=>/\b(?:portion|cup)\b/i.test(v)&&/\boz\b/i.test(v));
  const references=preparation.filter(v=>/\bpars?\b|\breferences?\b/i.test(v)&&/\bpans?\b/i.test(v)&&/\bcups?\b/i.test(v));
  const referenceText=references.join('\n');
  const complete=portion.length>0&&names.split('|').every(name=>new RegExp('\\b'+name+'\\b','i').test(referenceText));
  return {source:e.source,preparation,portion,references,complete};
 });
 const current=candidates.filter(c=>c.complete);
 if(!current.length)return {answer:'The current approved Back Window material does not supply the full requested portion-size and cup/pan reference list in this answer. Ask your manager for the current approved references; do not assume a par is one pan or infer missing cup sizes, capacity or production.',sources:approved.map(e=>e.source)};
 const signatures=new Set(current.map(c=>[...c.portion,...c.references].join('\n').replace(/\s+/g,' ').toLowerCase()));
 if(signatures.size>1)return {answer:'The current approved Back Window portion references conflict. Ask your manager to confirm the current approved version before using cup or pan quantities. Do not choose a par as a one-pan capacity or infer production.',sources:current.map(c=>c.source)};
 const reference=current[0],opening=/\b(?:opening|starting|start|before\s+(?:work|starting))\b/i.test(question);
 const lines=opening?reference.preparation:[...reference.portion,...reference.references,...reference.preparation.filter(v=>/\busage\b|\bbuffer\b|\bhard\s+maximum\b/i.test(v))];
 return {answer:'Current approved Back Window '+(opening?'opening and portion references:':'portion references:')+'\n'+[...new Set(lines)].map((line,i)=>`${i+1}. ${line}`).join('\n')+'\n\nThese are ready-cup reference pars, not a verified on-hand count or an automatic instruction to make the difference. Your reported count remains your observation. Use explicitly supplied expected usage, usable stock and a manager-confirmed buffer, and follow any current released assignment and approved recipe for actual work. Chat does not change stock or record production.',sources:[reference.source]};
}

export function checkedBackWindowCupReferences(question:string,answer:string,evidence:readonly Evidence[]):string{
 return companionBackWindowCupReferences(question,evidence)?.answer??answer;
}

/** Narrow arithmetic aid, not a stock observation or production recommendation.
 * Input evidence must be the CURRENT authorized Companion evidence, not history
 * or raw records. A reference par is divided by its explicit number of pans;
 * neither the reference quantity nor the cup's ounce label is a per-pan yield. */
export function companionBackWindowCups(question:string,evidence:readonly Evidence[]):BackWindowCupCalculation|null{
 if(!/\b(?:deep\s+half|sixth)\s+pans?\b/i.test(question))return null;
 const sources:ChatSource[]=[],capacities:Capacity[]=[],reasons:string[]=[];
 for(const entry of evidence){
  const text=approvedBackWindowText(entry);if(!text)continue;
  // Saved source prose may say "ranch two pans", "Ranch: two pans",
  // "Ranch, two pans" or "Ranch (two pans ...)". Pan quantity remains
  // mandatory; "ranch par100cups" never supplies a one-pan capacity.
  const references=new RegExp('\\b('+names+')\\s*(?::|,|\\()?\\s*('+quantity+')\\s+(deep\\s+half|sixth)\\s+pans?[^;\\n]*?\\b(\\d+(?:\\.\\d+)?)\\s+cups\\b','gi');
  for(const match of text.matchAll(references)){
   const pans=number(match[2]),cups=Number(match[4]),container:Pan=/deep/i.test(match[3])?'deep-half':'sixth';
   if(!finite(pans)||pans<=0||!finite(cups)||cups<=0)continue;
   capacities.push({container,referencePans:pans,referenceCups:cups,cupsPerPan:cups/pans,sourceId:entry.source.id});
   if(!sources.some(s=>s.id===entry.source.id))sources.push(entry.source);
  }
 }
 if(!capacities.length)return {status:'needs-review',sources,reasons:['Current approved Back Window evidence does not supply ready-cup capacities with explicit pan counts. Ask the manager for the current reference; do not assume a par is one pan.']};
 for(const container of ['deep-half','sixth'] as const){const values=capacities.filter(c=>c.container===container).map(c=>c.cupsPerPan);if(new Set(values).size>1)reasons.push(`Current approved ${container} references conflict; ask the manager rather than choosing a capacity.`);}
 if(/\bnegative\b/i.test(question))reasons.push('Pan counts must be explicitly nonnegative.');
 const pans=new RegExp('(?<![\\w.])(?:('+quantity+')\\s+)?(?:(half[- ]full|quarter[- ]full|full)\\s+)?(?:('+names+')\\s+)?(deep\\s+half|sixth)\\s+pans?\\b','gi');
 const matches=[...question.matchAll(pans)],components:Component[]=[];
 let previousItem:string|undefined;
 for(let index=0;index<matches.length;index++){
  const match=matches[index],container:Pan=/deep/i.test(match[4])?'deep-half':'sixth';
  const after=question.slice(match.index!+match[0].length,matches[index+1]?.index??question.length).split(/(?<!\d)[.!?]|[.!?](?!\d)/)[0];
  const before=question.slice(index?matches[index-1].index!+matches[index-1][0].length:0,match.index);
  const preceding=[...before.matchAll(new RegExp('\\b('+names+')\\b','gi'))].at(-1)?.[1];
  const item=(match[3]??after.match(new RegExp('\\b('+names+')\\b','i'))?.[1]??preceding??previousItem)?.toLowerCase();
  const count=match[1]===undefined?NaN:number(match[1])*(match[2]?.startsWith('half')?0.5:match[2]?.startsWith('quarter')?0.25:1);
  const capacity=capacities.find(c=>c.container===container);
  if(!item||!finite(count)||!capacity){reasons.push('A dressing name, explicit nonnegative pan quantity or current approved capacity is missing. Confirm the count rather than guessing.');continue;}
  previousItem=item;
  const cups=count*capacity.cupsPerPan;
  if(!finite(cups)){reasons.push('The cup estimate is too large. Review the pan count.');continue;}
  const existing=components.find(c=>c.item===item&&c.container===container);
  if(existing){existing.panCount+=count;existing.estimatedCups+=cups;}else components.push({item,container,panCount:count,cupsPerPan:capacity.cupsPerPan,estimatedCups:cups});
 }
 const estimatedTotalCups=components.reduce((total,c)=>total+c.estimatedCups,0);
 if(!matches.length||!finite(estimatedTotalCups))reasons.push('Pan quantities could not be safely calculated.');
 if(reasons.length)return {status:'needs-review',sources,reasons:[...new Set(reasons)]};
 return {status:'ready',authority:'calculation from current approved guide and user-reported pan quantities',sources,capacities,components,estimatedTotalCups,estimated:true,limits:['These are approximate ready-cup estimates from the reported pan fill, not a verified physical count or live inventory. Count actual ready cups for exact stock.','No forecast, buffer, shelf life, production recommendation, inventory posting or completed action is inferred. The ounce label does not establish recipe yield.']};
}

/** A par shortfall without demand/buffer inputs cannot establish production.
 * Only replaces this narrow automatic-top-up answer when current approved
 * Back Window evidence explicitly supplies the coverage-based guidance. */
export function checkedBackWindowTopUp(question:string,answer:string,evidence:readonly Evidence[]):string{
 if(!/\bpar\b/i.test(question)||!new RegExp('\\b('+names+')\\b','i').test(question)||!/\bautomatically\s+(?:make|prep|fill|top)|\btop[ -]?up\b|\bfill\s+(?:it|the\s+par|to\s+par)\b/i.test(question))return answer;
 const knownQuantity='(?:\\d+(?:\\.\\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten)';
 const suppliedUsage=new RegExp('\\b(?:expects?|expected(?:\\s+(?:use|usage))?|usage|demand)\\s*(?:of|:|is)?\\s*'+knownQuantity,'i').test(question);
 const suppliedBuffer=new RegExp('\\bbuffer\\s*(?:of|:|is)?\\s*'+knownQuantity+'\\b|\\b'+knownQuantity+'\\s*(?:cups?\\s+)?(?:extra|buffer)\\b','i').test(question);
 if(suppliedUsage&&suppliedBuffer)return answer;
 const approved=evidence.some(entry=>{const text=approvedBackWindowText(entry);return !!text&&/\busage\b/i.test(text)&&/\busable\b/i.test(text)&&/\bbuffer\b/i.test(text)&&/\bpars?\b/i.test(text);});
 if(!approved)return answer;
 return 'No. Do not automatically make cups solely to fill the reference par.\n\nUse expected usage until the next prep plus a manager-confirmed buffer, minus usable ready cups. Follow current approved shelf-life guidance if it is supplied, and review any current manager-released prep assignment before changing that work.\n\nThe needed usage or buffer inputs are not supplied here. Ask your manager for the current prep recommendation rather than inventing a quantity from the par shortfall. This chat does not change stock or record prep.';
}

type CupHistory={question:string;answer?:string;focus?:ChatSource|null};
type ReadyBasis='explicit user cup quantity'|'current question pan estimate'|'explicitly referenced previous user pan scenario';
type CupNeedResult={status:'ready';item:string;demandCups:number;explicitBufferCups:number|null;readyCups:number;readyBasis:ReadyBasis;targetCups:number;additionalWholeCups:number;sources:ChatSource[];estimatedReady:boolean;limits:string[]}|{status:'needs-review';reasons:string[];sources:ChatSource[]};
const numericInput='[-+]?\\d+(?:\\.\\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten';

/** Calculates additional cups, never gross demand, from explicit same-item
 * scenario inputs. Historical model answers cannot establish on-hand stock.
 * A prior user pan scenario is used only when the current question explicitly
 * refers back to that estimate and the current approved capacity is supplied. */
export function companionBackWindowAdditionalCups(question:string,evidence:readonly Evidence[],history:readonly CupHistory[]=[]):CupNeedResult|null{
 if(!/\b(?:how many|amount|additional|more)\b/i.test(question)||!/\b(?:prepare(?:d)?|prep|make|making|portion(?:s|ing)?|needed)\b/i.test(question))return null;
 const sources=evidence.filter(e=>approvedBackWindowText(e)).map(e=>e.source);
 if(!sources.length)return null;
 const demandPattern=new RegExp('\\b(?:need(?:ed)?|demand|expected\\s+(?:use|usage))\\s*(?:of|is|:|=|for)?\\s*('+numericInput+')\\s*(?:('+names+')\\s+)?cups?\\b','gi');
 const demands=[...question.matchAll(demandPattern)];
 if(!demands.length)return null;
 const items=[...new Set([...question.matchAll(new RegExp('\\b('+names+')\\b','gi'))].map(m=>m[1].toLowerCase()))];
 const quantities=[...new Set(demands.map(m=>number(m[1])))];
 if(items.length!==1||quantities.length!==1||/\b(?:between|either|or)\b/i.test(question))return {status:'needs-review',sources,reasons:['Confirm one dressing and one stated demand before calculating additional cups.']};
 const item=items[0],demandCups=quantities[0],reasons:string[]=[];
 if(!finite(demandCups)||/\bnegative\b/i.test(question))reasons.push('The stated demand must be an explicit nonnegative cup quantity.');
 const bufferMatches=[...question.matchAll(new RegExp('\\bbuffer\\s*(?:of|is|:|=)?\\s*('+numericInput+')\\b|\\b('+numericInput+')\\s*(?:cups?\\s+)?(?:extra|buffer)\\b','gi'))].map(m=>number(m[1]??m[2]));
 if(/\bno\s+buffer\b/i.test(question))bufferMatches.push(0);
 const buffers=[...new Set(bufferMatches)];
 const explicitBufferCups=buffers[0]??null;
 if(buffers.length>1||buffers.some(v=>!finite(v)))reasons.push('Confirm one nonnegative buffer quantity.');
 if(/\bbuffer\b/i.test(question)&&!buffers.length)reasons.push('The buffer is mentioned but its amount is missing.');

 const readyMatches:number[]=[];
 const readyPatterns=[
  new RegExp('\\busing\\s+(?:the\\s+|an?\\s+|about\\s+|approximately\\s+)?('+numericInput+')\\s*[- ]cups?\\s+(?:pan\\s+)?estimate\\b','gi'),
  new RegExp('\\b(?:with|have|already have|counted)\\s+(?:about\\s+|approximately\\s+)?('+numericInput+')\\s+(?:(?:usable|ready|available|estimated)\\s+(?:('+names+')\\s+)?cups?|(?:('+names+')\\s+)?cups?\\s+(?:usable|ready|on[ -]?hand|available|left))\\b','gi'),
  new RegExp('\\b(?:usable|ready|on[ -]?hand|available)\\s*(?:cups?\\s*)?(?:is|:|=)?\\s*('+numericInput+')\\s+cups?\\b','gi'),
 ];
 for(const pattern of readyPatterns)for(const match of question.matchAll(pattern))readyMatches.push(number(match[1]));
 const readyValues=[...new Set(readyMatches)];
 let readyCups:number|undefined=readyValues[0],readyBasis:ReadyBasis='explicit user cup quantity';
 let estimatedReady=/\bestimate|estimated|pan\b/i.test(question);
 if(readyValues.length>1)reasons.push('Conflicting ready-cup quantities are supplied; confirm the usable amount.');
 if(readyValues.length===0){
  const current=companionBackWindowCups(question,evidence);
  if(current?.status==='ready'){
   const component=current.components.find(c=>c.item===item);
   if(component){readyCups=component.estimatedCups;readyBasis='current question pan estimate';estimatedReady=true;}
  }
  // Do not silently reuse a count from another day or a previous model answer.
  if(readyCups===undefined&&/\b(?:that|previous|just counted)\b[^.!?\n]*\b(?:pan|estimate|count)\b/i.test(question)){
   const prior=history.at(-1);
   const focusCurrent=!prior?.focus||sources.some(s=>s.id===prior.focus!.id&&s.revision===prior.focus!.revision);
   const counted=prior&&focusCurrent?companionBackWindowCups(prior.question,evidence):null;
   if(counted?.status==='ready'){
    const component=counted.components.find(c=>c.item===item);
    if(component){readyCups=component.estimatedCups;readyBasis='explicitly referenced previous user pan scenario';estimatedReady=true;}
   }
  }
 }
 if(readyCups===undefined||!finite(readyCups))reasons.push('Supply the usable ready-cup quantity or an explicitly referenced approved pan estimate; a reference par is not stock.');
 const targetCups=demandCups+(explicitBufferCups??0),additionalWholeCups=Math.ceil(Math.max(0,targetCups-(readyCups??0)));
 if(!finite(targetCups)||!Number.isSafeInteger(additionalWholeCups))reasons.push('The quantities are too large to calculate safely.');
 if(reasons.length)return {status:'needs-review',sources,reasons:[...new Set(reasons)]};
 return {status:'ready',item,demandCups,explicitBufferCups,readyCups:readyCups!,readyBasis,targetCups,additionalWholeCups,sources,estimatedReady,limits:['This covers only the explicitly stated demand and any explicitly supplied buffer, not a live forecast or automatic change to a released plan.','Ready-cup pan estimates are not verified physical counts. Only additional production is rounded upward to whole cups; stock is not rounded or posted.']};
}

export function checkedBackWindowAdditionalCups(question:string,answer:string,evidence:readonly Evidence[],history:readonly CupHistory[]=[]):string{
 const calculated=companionBackWindowAdditionalCups(question,evidence,history);
 if(!calculated)return answer;
 if(calculated.status==='needs-review')return `I need clear quantities before recommending additional cups. ${calculated.reasons.join(' ')} This chat does not infer a forecast, change stock or record prep.`;
 const buffer=calculated.explicitBufferCups!==null?` + ${calculated.explicitBufferCups} explicitly supplied buffer`:'';
 return `Prepare ${calculated.additionalWholeCups} additional whole ${calculated.item} cups for the stated scenario.\n\nCalculation: ${calculated.demandCups} stated need${buffer} - ${calculated.readyCups} ready cups = ${calculated.targetCups-calculated.readyCups} before clamping at zero and rounding additional production up to whole cups. The full demand is not the additional amount to make.\n\n${calculated.estimatedReady?'The ready-cup amount is a pan estimate, not a verified physical count. Count the actual ready cups before recording exact stock.':'The ready amount is user-supplied, not an app-observed inventory balance.'} This is scenario arithmetic; follow the current released assignment and approved recipe for actual work. Chat does not change stock, revise a plan or record production.`;
}
