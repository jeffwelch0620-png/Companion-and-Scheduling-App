const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const quantity='(?:\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty)';
const minutes=new RegExp('\\b'+quantity+'[ -]*(?:minutes?|seconds?)\\b','i');
function approvedNumericStep(step:string,kind:'cadence'|'wait'){
 // An example, rejected quota or hypothetical is not an approved target.
 if(/\b(?:not|no|never|avoid|unsupported|example|hypothetical|unapproved|do not|don't)\b/i.test(step))return false;
 if(!minutes.test(step))return false;
 const numericCadence=new RegExp('\\b(?:seat|seating|cadence|pace|interval|target)\\b[^.!?\\n]{0,120}\\b(?:every|per|interval|target)\\b[^.!?\\n]{0,40}'+quantity+'[ -]*(?:minutes?|seconds?)\\b|\\b(?:seat|seating|pace|cadence|target)\\b[^.!?\\n]{0,100}\\b(?:at|of)\\s+(?:(?:a|the)\\s+)?'+quantity+'[ -]*(?:minutes?|seconds?)[ -]*(?:seating\\s+)?intervals?\\b|\\b(?:use|follow)\\s+(?:(?:a|the)\\s+)?'+quantity+'[ -]*(?:minutes?|seconds?)[ -]*(?:seating|pacing)\\s+(?:interval|cadence|target)\\b','i');
 return kind==='cadence'?numericCadence.test(step):/\b(?:quote|promise|tell|use)\b/i.test(step)&&/\bwait\b/i.test(step);
}

/** Keep a requested Host timing decision on the actual approved evidence.
 * This does not observe floor capacity, invent a wait forecast or change work. */
export function checkedHostPace(context:unknown,question:string,answer:string):string{
 const waitQuery=/\b(?:promise|guarantee|quote)\b[^.!?\n]{0,90}\bwait\b|\bwait\b[^.!?\n]{0,90}\b(?:promise|guarantee|quote)\b/i.test(question);
 const cadenceQuery=/\b(?:seat|seating|party|parties|guests?)\b/i.test(question)&&(/\b(?:target|quota|cadence|interval|every|per)\b/i.test(question)&&(minutes.test(question)||/\b(?:numeric|numerical|fixed)\b/i.test(question)));
 if(!waitQuery&&!cadenceQuery)return answer;
 const entries=object(context).evidence;
 if(!Array.isArray(entries))return answer;
 const guides=entries.flatMap(entry=>{
  const e=object(entry),source=object(e.source),facts=object(e.facts),guide=object(facts.guide);
  if(source.kind!=='standard'||facts.authority!=='approved standard'||facts.position!=='Host'||facts.approvedInstructionCurrent===false||facts.instructionContentOmitted===true||!Array.isArray(guide.steps))return [];
  return [guide];
 });
 if(!guides.length)return answer;
 const steps=guides.flatMap(g=>(g.steps as unknown[]).filter((s):s is string=>typeof s==='string'));
 if(cadenceQuery&&steps.some(step=>approvedNumericStep(step,'cadence'))||waitQuery&&steps.some(step=>approvedNumericStep(step,'wait')))return answer;
 const text=guides.map(g=>[g.purpose,...(Array.isArray(g.preparation)?g.preparation:[]),...(g.steps as unknown[]),g.escalation].filter(s=>typeof s==='string').join(' ')).join(' ');
 if(!/\bwritten\s+(?:server\s+)?rotation\b/i.test(text)||!/\bsteady\b/i.test(text)||!/\bwelcom/i.test(text)||!/\bmanager\b/i.test(text))return answer;
 const floorChecks=/\bserver lineup\b/i.test(text)&&/\boccupied tables\b/i.test(text)&&/\b(?:meal progress|where guests are in their meals)\b/i.test(text)?' Check the current server lineup, occupied tables and meal progress.':'';
 return 'Do not promise a fixed wait or adopt a numerical seating interval from these facts, including as a personal pace goal. The current approved Host guide does not supply that timing target, and current floor capacity or a wait forecast is not verified here.\n\nUse the written server rotation and a steady, welcoming seating pace.'+floorChecks+' Ask the manager for seating pace and coverage direction when a server is overloaded. A user-suggested number does not establish an approved target.\n\nYou can tell waiting guests, as suggested wording: "We are working to seat you as soon as we can; I will check with the manager for an update." Only give a more specific estimate after confirming current information with the manager; do not present it as a guarantee.';
}
