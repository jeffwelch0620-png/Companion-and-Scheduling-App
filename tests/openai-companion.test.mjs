import test from 'node:test';
import assert from 'node:assert/strict';
import { askCompanion, maxCompanionRequestBytes } from '../.sites-runtime/shared/openai-companion.mjs';
const config={key:'sk-fictional-test-only',model:'gpt-5.4-mini'};
const source={id:'goal-current-uuid',revision:4,kind:'goal',title:'Fictional learning goal'};
const response=(sourceIds=[],text='A short fictional answer.')=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:text,sourceIds})}]}]});

test('the AI response contract restricts citations to current evidence instead of accepting arbitrary identifiers',async()=>{
 const result=await askCompanion(config,{evidence:[{source}]},[{question:'Old question',answer:'Old answer',focus:{...source,id:'outdated-goal'}}],'Explain this goal.',[source,source],async(_url,init)=>{
  const body=JSON.parse(init.body),format=body.text.format;
  assert.equal(format.strict,true);assert.deepEqual(format.schema.properties.sourceIds.items.enum,[source.id]);
  assert.equal(format.schema.properties.sourceIds.maxItems,1);assert.equal(format.schema.properties.answer.maxLength,6000);
  assert.ok(!JSON.stringify(format.schema).includes('outdated-goal'));
  return response([source.id]);
 });assert.deepEqual(result.sources,[source,source]);assert.equal(result.answer,'A short fictional answer.');
});

test('general chat without saved evidence uses an empty citation list and a valid nonempty-enum-free schema',async()=>{
 const result=await askCompanion(config,{},[],'Hello',[],async(_url,init)=>{
  const schema=JSON.parse(init.body).text.format.schema.properties.sourceIds;
  assert.equal(schema.maxItems,0);assert.equal(schema.items.enum,undefined);return response();
 });assert.deepEqual(result.sources,[]);
});

test('server validation still rejects invented references even if a provider ignores the constrained response contract',async()=>{
 await assert.rejects(askCompanion(config,{},[],'Hello',[source],async()=>response(['private-or-invented-id'])),/verify its answer references/);
 await assert.rejects(askCompanion(config,{},[],'Hello',[source],async()=>response(['Saved goal title'])),/verify its answer references/);
});

test('invalid answer text is distinguished from citation errors and no partial answer is accepted',async()=>{
 for(const text of ['', ' '.repeat(3),'x'.repeat(6001)])await assert.rejects(askCompanion(config,{},[],'Hello',[source],async()=>response([],text)),/empty or overly long/);
});

test('AI requests have a byte budget and retain complete recent exchanges, current instructions and the new question',async()=>{
 const method='Complete approved instruction '+ 'é'.repeat(12000),context={approvedMethod:method};
 const history=Array.from({length:8},(_,i)=>({question:`Question ${i} `+'🥣'.repeat(1000),answer:`Answer ${i} `+'é'.repeat(6000),focus:source}));
 await askCompanion(config,context,history,'Current question.',[source],async(_url,init)=>{
  assert.ok(new TextEncoder().encode(init.body).byteLength<=maxCompanionRequestBytes);
  const input=JSON.parse(init.body).input;
  assert.ok(input[1].content.includes(method));assert.equal(input.at(-1).content,'Current question.');
  const pairs=input.slice(2,-1);assert.ok(pairs.length>0&&pairs.length<history.length*2);assert.equal(pairs.length%2,0);
  const offset=history.length-pairs.length/2;assert.ok(input[1].content.includes(`"omittedEarlierExchanges":${offset}`));
  for(let i=0;i<pairs.length;i+=2){assert.ok(pairs[i].content.endsWith(history[offset+i/2].question));assert.equal(pairs[i+1].content,history[offset+i/2].answer)}
  return response([source.id]);
 });assert.equal(history.length,8);
});
test('oversized current evidence is rejected before any provider call rather than silently cutting its method',async()=>{
 let calls=0;
 await assert.rejects(askCompanion(config,{method:'🥣'.repeat(maxCompanionRequestBytes/2)},[],'Explain the method.',[source],async()=>{calls++;return response()}),e=>e.category==='context-limit'&&e.status===400&&e.message.includes('question is saved'));
 assert.equal(calls,0);
});

test('memory context drops only whole excerpts when necessary and preserves current approved instructions',async()=>{
 const approvedMethod='Complete approved method '+ 'é'.repeat(23000),entries=Array.from({length:8},(_,n)=>({userStatement:'Historical excerpt '+n+' '+ '🥣'.repeat(2500)}));
 const context={approvedMethod,priorConversationMemory:{entries,selection:'Relevant private excerpts'}};
 await askCompanion(config,context,[],'Use the current method.',[source],async(_url,init)=>{
  assert.ok(new TextEncoder().encode(init.body).byteLength<=maxCompanionRequestBytes);
  const input=JSON.parse(init.body).input,received=JSON.parse(input[1].content.split('\n').slice(1).join('\n'));
  assert.equal(received.approvedMethod,approvedMethod);assert.ok(received.priorConversationMemory.omittedExcerpts>0);
  assert.equal(received.priorConversationMemory.entries.length+received.priorConversationMemory.omittedExcerpts,entries.length);
  assert.equal(input.at(-1).content,'Use the current method.');return response([source.id]);
 });assert.equal(context.priorConversationMemory.entries.length,8);
});
