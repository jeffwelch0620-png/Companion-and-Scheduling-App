'use client';
import {useState} from 'react';
import type {RecordOf} from '../shared/types';
import type {Send} from './workspace';
import {LearningProgress} from './learning-progress';

export function GuidedPractice({goal,guide,send,onError}:{goal:RecordOf<'goal'>;guide:RecordOf<'standard'>;send:Send;onError:(message:string)=>void}) {
 const [checks,setChecks]=useState<number[]>(goal.data.practiceChecks??[]),[note,setNote]=useState('');
 const saved=goal.data.practiceChecks??[],dirty=checks.length!==saved.length||checks.some(i=>!saved.includes(i))||!!note.trim();
 const ready=checks.length===guide.data.criteria.length;
 return <form className="practice-session" onSubmit={async e=>{e.preventDefault();const step=(e.nativeEvent as SubmitEvent).submitter?.getAttribute('value');if(!step)return;try{await send('goal.transition',{step,note,checks},goal)}catch(error){onError(error instanceof Error?error.message:'Could not save your practice.')}}}>
  <div className="practice-heading"><h3>Your practice</h3><span role="status">{dirty?'Unsaved changes':'Progress saved'}</span></div>
  <LearningProgress count={checks.length} total={guide.data.criteria.length}/>
  <p className="practice-hint">Check each step as you practice. Your manager confirms the outcome.</p>
  <div className="learning-criteria">{guide.data.criteria.map((criterion,i)=><label key={i} data-checked={checks.includes(i)}><input type="checkbox" checked={checks.includes(i)} onChange={e=>setChecks(current=>e.target.checked?[...current,i]:current.filter(n=>n!==i))}/><span>{criterion}</span></label>)}</div>
  <details className="practice-note"><summary>Add a note or question</summary><label className="shared-field">What would help?<textarea value={note} maxLength={2000} onChange={e=>setNote(e.target.value)}/></label></details>
  <div className="practice-actions"><button className="shared-primary" value={ready?'ready':'practice'} disabled={!ready&&!dirty}>{ready?'Ready for a manager check':'Save progress'}</button>{ready&&dirty&&<button className="inline-action" value="practice">Save for later</button>}</div>
 </form>;
}
