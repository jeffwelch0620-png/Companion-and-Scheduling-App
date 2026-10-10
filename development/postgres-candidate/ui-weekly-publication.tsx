import {personName} from '../../app/shared/types';
import {displayTime} from '../../app/shared/local-time';
import {publicationInput,publishableDrafts,type PublicationReview,type PublicationWorkspace} from './weekly-publication-client.mjs';
import type {Send} from './ui-form-types';

export function WeeklyPublicationReview({w,review,now,busy,send,onError,onBack}:{w:PublicationWorkspace;review:PublicationReview;now:string;busy:boolean;send:Send;onError:(message:string)=>void;onBack:()=>void}) {
 const eligible=publishableDrafts(w,review.weekStart,now);
 if(review.locationId!==w.location.id||review.actorId!==w.me.id||!eligible.length)return null;
 const stale=review.scheduleRevision!==w.scheduleRevision||review.drafts.some(r=>!eligible.some(s=>s.id===r.id&&s.revision===r.revision));
 const blocked=stale||review.drafts.some(r=>!r.sourceReviewComplete||r.closingIssues.length>0||r.copiedStaffing.length>0),zone=w.location.timezone;
 return <form className="shared-publish-review" onSubmit={async e=>{e.preventDefault();if(blocked||busy)return;const fields=new FormData(e.currentTarget);try{await send('shift.publish-batch',publicationInput(review,{confirmed:fields.get('confirmed')==='on',note:String(fields.get('note')??''),coverageAcknowledged:fields.get('coverageAcknowledged')==='on',coverageNote:String(fields.get('coverageNote')??'')}));}catch(e){onError(e instanceof Error?e.message:'Publication could not be confirmed.');}}}>
  <h2>Review selected shifts</h2><p>Week of {review.weekStart}. Only these {review.drafts.length} saved drafts will publish. If any selected shift fails a check, none of the selection will publish.</p>
  {stale&&<p role="alert" className="shared-error">The selection changed. Reload and review current records.</p>}
  <ul>{review.drafts.map(r=><li key={r.id}><strong>{personName(w,r.ownerId,'Employee')} · {r.data.position} · {r.area}</strong><p>{displayTime(r.data.start,zone)} → {displayTime(r.data.end,zone)}</p>
   <details><summary>Closing responsibilities: {r.closing.length}</summary>{r.closing.map(c=><article key={c.id}><strong>{c.standard.title} · v{c.standard.version}</strong><p>Due {displayTime(c.due,zone)} · Final check: {personName(w,c.managerId,'Assigned manager')}{c.verifierId?' · First check: '+personName(w,c.verifierId,'Assigned verifier'):''}</p></article>)}</details>
   {!r.sourceReviewComplete&&<p role="alert">Schedule inputs need a complete source review before publication.</p>}
   {r.copiedStaffing.length>0&&<p role="alert">Copied staffing needs require approval or withdrawal before publication.</p>}
   {r.closingIssues.length>0&&<p role="alert">Closing instructions or assigned reviewers need correction before publication.</p>}
  </li>)}</ul>
  <h3>Staffing coverage</h3><p>{review.plannedGapCount?`${review.plannedGapCount} remaining coverage gaps. Only published shifts and this selection count toward coverage.`:'No remaining coverage gaps in the approved staffing needs for this selection.'}</p>
  {review.staffing.map(n=><article key={n.id}><strong>{n.data.title} · {n.area} · {n.data.position}</strong>{n.gaps.length?<ul>{n.gaps.map((g,i)=><li key={i}>{displayTime(g.start,zone)} → {displayTime(g.end,zone)} · {g.scheduled} scheduled / {g.required} required</li>)}</ul>:<p>Required coverage is met.</p>}</article>)}
  {review.plannedGapCount>0&&<><label className="shared-check"><input name="coverageAcknowledged" type="checkbox" required/>I reviewed the remaining coverage gaps.</label><label className="shared-field">Written coverage plan<textarea name="coverageNote" required maxLength={2000}/></label><p>The plan is retained with publication; it does not change the staffing requirement.</p></>}
  <label className="shared-field">Publication reason<textarea name="note" required maxLength={2000}/></label>
  <label className="shared-check"><input name="confirmed" type="checkbox" required/>I reviewed these shifts, closing responsibilities and staffing coverage.</label>
  <div className="shared-actions"><button type="submit" className="shared-primary" disabled={busy||blocked}>Publish {review.drafts.length} selected shifts</button><button type="button" disabled={busy} onClick={onBack}>Back to selection</button></div>
 </form>;
}
