'use client';
import type {AccessAccount,AccessCommand} from '../shared/access-types';

export function AdministratorRequestPanel({account,send}:{account:AccessAccount;send:(action:AccessCommand['action'],input:Record<string,unknown>,account:AccessAccount)=>Promise<unknown>}){
 const request=account.administratorRequest;
 if(!request||request.status==='approved'||(request.kind==='recovery'&&request.status==='cancelled'))return null;
 const expired=Date.parse(request.expiresAt)<=Date.now(),canApprove=request.status==='requested'&&!expired;
 const command=(action:AccessCommand['action'],input:Record<string,unknown>)=>send(action,{...input,administratorRequestId:request.requestId},account);
 return <section className="shared-card"><h3>{request.kind==='recovery'?'Owner account recovery':'Administrator invitation'}</h3>
 {request.kind==='invitation'&&<p>Administrator access stays off until this person signs in and an existing administrator approves their account.</p>}
 {request.kind==='recovery'&&<p>{account.name} has requested access from a verified sign-in. Approving will replace their old JMAX sign-in for this restaurant and sign out their setup-code devices.</p>}
 {request.status==='invited'&&<p>Ask {account.name} to open <a href="/login" target="_blank" rel="noreferrer">JMAX sign-in</a>, choose Owner sign-in, and continue with the ChatGPT account using <strong>{account.email}</strong>. Then reload this employee setup to review their request.</p>}
 {request.status==='requested'&&<p>Verified sign-in email: <strong>{request.verifiedEmail}</strong>. Contact {account.name} directly to confirm that they requested this access.</p>}
 {request.status==='cancelled'&&<p>This invitation was cancelled. Access remains off.</p>}
 {expired&&<p>This request expired. {request.kind==='invitation'?'Restart the invitation, then ask them to sign in again.':'Ask them to use Owner sign-in again, then reload this page.'}</p>}
 {canApprove&&<form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void command('administrator.approve',{identityConfirmed:f.get('identity')==='on',note:String(f.get('note')??'')})}}><label className="shared-check"><input type="checkbox" name="identity" required/>I confirmed with {account.name} that this is their own sign-in and that they should have the administrator permissions shown.</label><label className="shared-field">Approval note<textarea name="note" required maxLength={2000}/></label><button className="shared-primary">Approve verified sign-in</button></form>}
 {request.kind==='invitation'&&<button onClick={()=>void command('administrator.resend',{note:'Restarted this unapproved administrator invitation; a fresh sign-in is required.'})}>Restart invitation</button>}
 {(request.status==='invited'||request.status==='requested')&&<button onClick={()=>void command('administrator.cancel',{note:'Cancelled this administrator sign-in request without granting new access.'})}>Cancel request</button>}
 </section>;
}
