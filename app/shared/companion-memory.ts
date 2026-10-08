import {scopeCurrent} from './companion-context';
import {prepRevision} from './companion-prep';
import type {Workspace} from './types';
import type {ChatSource,ChatTurn} from './companion-chat-types';

type Database=Pick<D1Database,'prepare'|'batch'>;
export type MemoryTurn={request_id:string;conversation_id:string;fingerprint:string;question:string;answer:string;status:ChatTurn['status'];sources:string;scope:string;error:string;at:string;focus:string|null;memory_refs?:string};
export type MemoryConversation={id:string;membership_revision:number};
const stop=new Set('a an and are as at be been but by can could did do does for from had has have how i in is it its me my of on or our please that the their them then there these they this to was we were what when where which who why will with would you your remember earlier before about now again'.split(' '));
function searchTerms(question:string){return [...new Set(question.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)??[])].filter(t=>t.length>=3&&!stop.has(t)).slice(0,10);}
const references=(r:MemoryTurn)=>JSON.parse(r.memory_refs??'[]') as string[];
export async function validMemoryConversations(db:Database,w:Workspace,c:MemoryConversation){
  const rows=(await db.prepare('SELECT id FROM companion_archives WHERE location_id=? AND member_id=? AND membership_revision=?').bind(w.location.id,w.me.id,c.membership_revision).all<{id:string}>()).results;
  return new Set([c.id,...rows.map(r=>r.id)]);
}
export function dependenciesCurrent(row:MemoryTurn,valid:Set<string>){return references(row).every(id=>valid.has(id));}
export function memoryReferences(rows:MemoryTurn[],currentId:string){return [...new Set(rows.flatMap(r=>[...references(r),...(r.conversation_id!==currentId?[r.conversation_id]:[])]))].filter(id=>id!==currentId);}

// Search all retained conversations for relevant excerpts, not just the last
// chat or week. Bounded candidate and context sizes avoid sending the full diary.
export async function readCompanionMemory(db:Database,w:Workspace,c:MemoryConversation,question:string,now:number,options:{excludeIds:string[];selectedWork?:ChatSource;generalLearningQuestion?:boolean;workforce?:boolean}){
  const empty={entries:[] as {requestId:string;conversationId:string;at:string;userStatement:string;priorAssistantAnswer?:string;sources:ChatSource[];provenance:string;truncated:boolean}[],rows:[] as MemoryTurn[],validationSources:[] as ChatSource[]};
  if(options.generalLearningQuestion)return empty;
  const terms=searchTerms(question),score=terms.length?terms.map(()=>'(CASE WHEN instr(lower(t.question),?)>0 THEN 1 ELSE 0 END)').join('+'):'0';
  const base=`FROM companion_turns t LEFT JOIN companion_archives a ON a.location_id=t.location_id AND a.member_id=t.member_id AND a.id=t.conversation_id WHERE t.location_id=? AND t.member_id=? AND t.status='complete' AND (t.conversation_id=? OR a.membership_revision=?)`;
  const values=[w.location.id,w.me.id,c.id,c.membership_revision];
  const relevant=(await db.prepare(`SELECT t.*,${score} AS relevance ${base} ${terms.length?'AND ('+score+')>0':''} ORDER BY relevance DESC,t.at DESC,t.request_id DESC LIMIT 48`).bind(...terms,...values,...terms).all<MemoryTurn&{relevance:number}>()).results;
  const recent=(await db.prepare(`SELECT t.* ${base} ORDER BY t.at DESC,t.request_id DESC LIMIT 16`).bind(...values).all<MemoryTurn>()).results;
  // Direct topic matches must not lose their slots to unrelated neighbors
  // of later recalls. Personal declarations and original reports take
  // precedence over questions that merely ask to retrieve those reports.
  const preferenceReport=(row:MemoryTurn)=>/\b(?:i (?:\w+ ){0,3}prefer|my (?:communication )?preference (?:is|means|for)|call me|my name is)\b/i.test(row.question);
  const recallRequest=(row:MemoryTurn)=>/^\s*(?:recall\b|do you remember\b|what (?:did|was|were)\b.{0,100}\b(?:earlier|before|previous)\b)/i.test(row.question);
  const rank=(row:MemoryTurn)=>preferenceReport(row)?1:recallRequest(row)?-1:0;
  const ranked=[...relevant].sort((a,b)=>rank(b)-rank(a));
  // Search neighbors after ranking so a newly prioritized original also
  // brings its correction. Limit ordinary adjacency to one turn per hit;
  // explicit corrections among the next three take priority over that turn.
  const neighbors=new Map<string,MemoryTurn[]>();
  for(const hit of ranked.slice(0,4))neighbors.set(hit.request_id,(await db.prepare(`SELECT t.* ${base} AND t.conversation_id=? AND (t.at>? OR (t.at=? AND t.request_id>=?)) ORDER BY t.at,t.request_id LIMIT 4`).bind(...values,hit.conversation_id,hit.at,hit.at,hit.request_id).all<MemoryTurn>()).results);
  const adjacent=[...neighbors.values()].flat(),directIds=new Set(ranked.slice(0,4).map(r=>r.request_id));
  const isCorrection=(row:MemoryTurn)=>/^\s*(?:no\b|actually\b|correction\b|i meant\b|to clarify\b|that['’]s wrong\b|that is wrong\b)/i.test(row.question);
  const corrections=adjacent.filter(isCorrection);
  const valid=await validMemoryConversations(db,w,c),personalCorrections=new Set<string>();
  for(const hit of ranked.slice(0,4))if(dependenciesCurrent(hit,valid)&&preferenceReport(hit)&&!JSON.parse(hit.focus??'null')&&!JSON.parse(hit.sources).length)for(const neighbor of neighbors.get(hit.request_id)??[])if(isCorrection(neighbor)&&!JSON.parse(neighbor.focus??'null')&&!JSON.parse(neighbor.sources).length)personalCorrections.add(neighbor.request_id);
  const nextReplies=[...neighbors.values()].flatMap(group=>{const next=group.find(r=>!directIds.has(r.request_id));return next?[next]:[];});
  const excluded=new Set(options.excludeIds),seen=new Set<string>(),rows=[...ranked.slice(0,4),...corrections,...nextReplies,...ranked.slice(4),...adjacent,...recent];
  const foodRevision=rows.some(r=>(JSON.parse(r.scope) as ChatSource[]).some(s=>s.kind==='food-prep'))?await prepRevision(db,w.location.id):undefined;
  const result=empty;let characters=0;
  for(const row of rows){
    if(seen.has(row.request_id)||excluded.has(row.request_id))continue;seen.add(row.request_id);
    if(!dependenciesCurrent(row,valid))continue;
    const sources=JSON.parse(row.sources) as ChatSource[],scope=JSON.parse(row.scope) as ChatSource[],focus=JSON.parse(row.focus??'null') as ChatSource|null;
    if(options.workforce&&sources.some(s=>!['schedule-week','shift','goal','standard','food-prep','close','task','handoff','leadership','learningcase'].includes(s.kind)))continue;
    if(options.selectedWork&&!(focus?.id===options.selectedWork.id&&focus.revision===options.selectedWork.revision||sources.some(s=>s.id===options.selectedWork!.id&&s.revision===options.selectedWork!.revision)))continue;
    const current=scopeCurrent(scope,w,new Date(now).toISOString(),foodRevision);
    // A communication preference is the user's report, not a schedule fact.
    // Retain only that statement across work/snapshot changes; never its old
    // assistant answer or a source-backed operating instruction. Membership
    // revision, restaurant and deletion boundaries still apply.
    const personal=!focus&&!sources.length&&(/\b(prefer|preference|call me|my name|remember my)\b/i.test(row.question)||personalCorrections.has(row.request_id));
    if(!current&&!personal)continue;
    const userStatement=row.question.slice(0,1200),priorAssistantAnswer=current&&!personal?row.answer.slice(0,1600):undefined;
    const size=userStatement.length+(priorAssistantAnswer?.length??0);if(characters+size>14000)continue;
    characters+=size;
    result.entries.push({requestId:row.request_id,conversationId:row.conversation_id,at:row.at,userStatement,...(priorAssistantAnswer?{priorAssistantAnswer}:{}),sources:current?sources:[],provenance:'Private historical conversation. User statements are reports; previous AI answers are not verified policy or proof of completed work.',truncated:userStatement.length!==row.question.length||(priorAssistantAnswer!==undefined&&priorAssistantAnswer.length!==row.answer.length)});
    result.rows.push(row);if(current&&!personal)result.validationSources.push(...scope);
    if(result.entries.length>=8)break;
  }
  return result;
}

export async function recalledRowsStillPresent(db:Database,w:Workspace,c:MemoryConversation,rows:MemoryTurn[]){
  const valid=await validMemoryConversations(db,w,c);
  for(const row of rows){
    if(!valid.has(row.conversation_id)||!dependenciesCurrent(row,valid))return false;
    const found=await db.prepare('SELECT question,answer,status,memory_refs FROM companion_turns WHERE location_id=? AND member_id=? AND request_id=? AND conversation_id=?').bind(w.location.id,w.me.id,row.request_id,row.conversation_id).first<Pick<MemoryTurn,'question'|'answer'|'status'|'memory_refs'>>();
    if(!found||found.status!=='complete'||found.question!==row.question||found.answer!==row.answer||found.memory_refs!==(row.memory_refs??'[]'))return false;
  }
  return true;
}
