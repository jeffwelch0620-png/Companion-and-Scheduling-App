'use client';
import { attentionReasons, canAcknowledgeClose, needsCloseAcknowledgment } from '../shared/close-attention';
import { displayTime } from '../shared/local-time';
import { personName, type RecordOf, type Workspace } from '../shared/types';
import type { Send } from './workspace';

export function CloseAttention({w,record:r,send,onError}:{w:Workspace;record:RecordOf<'close'>;send:Send;onError:(message:string)=>void}){
  const attention=r.data.attention;
  if(!attention)return null;
  const pending=needsCloseAcknowledgment(r);
  return <section className="companion-correction" aria-label="Closing manager attention"><h3>{pending?'Manager acknowledgment needed':'Manager acknowledgment recorded'}</h3>
    <p><strong>{attentionReasons[attention.reason]}</strong> · Reported by {personName(w,attention.raisedBy)} on {displayTime(attention.raisedAt,w.location.timezone)}</p><p className="shared-message">{attention.note}</p>
    <p>{pending?`${personName(w,r.data.managerId)} needs to acknowledge this issue. Correction work and physical checks are still separate steps.`:'Acknowledging the issue does not complete the correction or pass a physical check.'}</p>
    {attention.acknowledgment&&<p className="shared-message">{personName(w,attention.acknowledgment.by)} · {displayTime(attention.acknowledgment.at,w.location.timezone)}: {attention.acknowledgment.note}</p>}
    {pending&&canAcknowledgeClose(w,r)&&!['closed','cancelled'].includes(r.data.phase)&&<form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await send('close.acknowledge',{note:String(f.get('acknowledgment')??'')},r)}catch(error){onError(error instanceof Error?error.message:'The acknowledgment could not be saved.')}}}>
      <label className="shared-field">Manager response and next step<textarea name="acknowledgment" required maxLength={2000}/></label><button className="shared-primary">Acknowledge the issue</button>
    </form>}
  </section>;
}
