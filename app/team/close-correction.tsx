'use client';
import { eligibleCorrectionHelper } from '../shared/close-correction';
import { assignedLeader } from '../shared/schedule-policy';
import { personName, has, type RecordOf, type Workspace } from '../shared/types';
import {canManageClosing} from '../shared/closing-access';
import type { Send } from './workspace';

export function CorrectionAssignment({w,record:r,send,onError}:{w:Workspace;record:RecordOf<'close'>;send:Send;onError:(message:string)=>void}){
  if(r.data.phase!=='correction')return null;
  const manager=w.me.id===r.data.managerId&&canManageClosing(w.me,r.area,'tasks.manage')&&canManageClosing(w.me,r.area,'close.confirm')&&(has(w.me,'location.manage')||assignedLeader(w,w.me,r.area,{start:r.data.due,end:r.data.due}));
  const candidates=w.members.filter(m=>eligibleCorrectionHelper(r,m));
  return <section><h3>Who is completing the correction</h3><p><strong>{personName(w,r.data.correction?.personId??r.ownerId)}</strong> is assigned to correct the work. {personName(w,r.ownerId)} remains responsible for the close.</p>{r.data.correction&&<p>{r.data.correction.note}</p>}
    {manager&&<details><summary>Assign correction help or return it to the closer</summary><p>Choose someone with reviewed clearance for {r.data.standard.position}. The first checker and closing manager remain independent. This changes who corrects the work; the close stays open.</p><form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await send('close.correction.assign',{personId:String(f.get('personId')??''),note:String(f.get('note')??'')},r)}catch(error){onError(error instanceof Error?error.message:'The correction assignment could not be saved.')}}}>
      <label className="shared-field">Person completing this correction<select name="personId" required defaultValue={candidates.some(m=>m.id===(r.data.correction?.personId??r.ownerId))?(r.data.correction?.personId??r.ownerId):''}><option value="">Choose a person</option>{candidates.map(m=><option key={m.id} value={m.id}>{m.name}{m.id===r.ownerId?' · Original closer':''}</option>)}</select></label><label className="shared-field">Correction assignment and reason<textarea name="note" required maxLength={2000}/></label><button className="shared-primary">Save correction assignment</button>
    </form></details>}
  </section>;
}
