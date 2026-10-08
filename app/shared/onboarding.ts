import type {AccessAccount,AccessCommand,AccessResult,AccessReview,AccessState} from './access-types';
import type {ToastPerson} from './toast-roster';
import {approvedStationGuides} from './station-knowledge';
import type {Workspace} from './types';

// Follow the server receipt, never a name or an email guess, after a write.
export function nextAccessSelection(state:AccessState,command:AccessCommand,result:AccessResult):{account:AccessAccount}|{person:ToastPerson;review:AccessReview}|null {
  if(command.action==='review.save'){
    const review=state.reviews.find(r=>r.id===result.recordId);
    const person=review&&state.roster?.restaurantGuid===review.restaurantGuid?state.roster.employees.find(p=>p.toastEmployeeId===review.employeeId):undefined;
    return review&&person?{person,review}:null;
  }
  const account=state.accounts.find(a=>a.id===result.recordId);
  return account?{account}:null;
}

export function filterSetupPeople(state:AccessState,query:string,archived=false,linked=false){
  const search=query.trim().toLowerCase();
  return (state.roster?.employees??[]).map(person=>{
    const review=state.reviews.find(r=>r.restaurantGuid===state.roster?.restaurantGuid&&r.employeeId===person.toastEmployeeId);
    const account=review?.memberId?state.accounts.find(a=>a.id===review.memberId):undefined;
    return {person,review,account};
  }).filter(({person,review})=>(archived||!person.archived)&&(linked||!review?.memberId)&&`${person.name} ${person.email??''} ${person.jobs.map(j=>j.title).join(' ')}`.toLowerCase().includes(search))
    .sort((a,b)=>Number(!!b.account)-Number(!!a.account)||a.person.name.localeCompare(b.person.name));
}

export function employeeWelcome(w:Workspace,now=new Date().toISOString()){
  const shifts=w.records.filter(r=>r.kind==='shift'&&r.ownerId===w.me.id&&r.data.published&&!r.data.cancelled&&!r.data.releasedAt&&r.data.end>now);
  const nextShift=shifts.sort((a,b)=>a.kind==='shift'&&b.kind==='shift'?a.data.start.localeCompare(b.data.start):0)[0];
  const goals=w.records.filter(r=>r.kind==='goal'&&r.ownerId===w.me.id&&!['closed','cancelled','declined'].includes(r.data.phase));
  const guides=approvedStationGuides(w);
  const managerIds=new Set(goals.flatMap(r=>r.kind==='goal'?[r.data.managerId]:[]));
  const managers=w.members.filter(m=>managerIds.has(m.id));
  return {nextShift:nextShift?.kind==='shift'?nextShift:null,goals,guides,managers};
}
