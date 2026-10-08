import test from 'node:test';
import assert from 'node:assert/strict';
import {nextAccessSelection,filterSetupPeople,employeeWelcome} from '../.sites-runtime/shared/onboarding.mjs';
const person=(id,name,archived=false)=>({toastEmployeeId:id,name,email:id+'@example.test',archived,jobs:[{title:'Cook'}]});
const a={id:'account-a',name:'Same Name',email:'a@example.test'},b={id:'account-b',name:'Same Name',email:'b@example.test'};
const review={id:'review-a',employeeId:'toast-a',restaurantGuid:'restaurant',memberId:'account-a',status:'applied'};
const state={accounts:[a,b],roster:{restaurantGuid:'restaurant',employees:[person('toast-a','Same Name'),person('toast-b','Same Name'),person('archived','Old Person',true)]},reviews:[review]};
test('setup defaults to active unlinked employees; explicit filters and search preserve exact Toast links',()=>{
 assert.deepEqual(filterSetupPeople(state,'').map(x=>x.person.toastEmployeeId),['toast-b']);
 assert.equal(filterSetupPeople(state,'a@example.test',false,true)[0].account.id,'account-a');
 assert.equal(filterSetupPeople(state,'Old Person').length,0);
 assert.equal(filterSetupPeople(state,'Old Person',true).length,1);
 const foreign={...state,reviews:[{...review,restaurantGuid:'elsewhere'}]};
 assert.equal(filterSetupPeople(foreign,'',false,true).filter(x=>x.account).length,0);
});
test('successful writes stay with the exact receipt target instead of matching names',()=>{
 assert.equal(nextAccessSelection(state,{action:'review.apply'},{recordId:'account-b'}).account.id,'account-b');
 assert.equal(nextAccessSelection(state,{action:'hire.save'},{recordId:'missing'}),null);
 assert.equal(nextAccessSelection(state,{action:'review.save'},{recordId:'review-a'}).person.toastEmployeeId,'toast-a');
 assert.equal(nextAccessSelection({...state,roster:{...state.roster,restaurantGuid:'elsewhere'}},{action:'review.save'},{recordId:'review-a'}),null);
});
test('welcome uses only current personal published work and approved training, never drafts or another person',()=>{
 const shift=(id,ownerId,published,start,cancelled=false)=>({id,kind:'shift',locationId:'r',ownerId,data:{start,end:'2026-09-19T23:00:00Z',published,cancelled,position:'Cook'}});
 const w={me:{id:'me',locationId:'r',area:'BOH',position:'Cook',capabilities:[]},members:[],records:[shift('draft','me',false,'2026-09-18T10:00:00Z'),shift('other','other',true,'2026-09-18T09:00:00Z'),shift('cancelled','me',true,'2026-09-18T08:00:00Z',true),shift('real','me',true,'2026-09-19T17:00:00Z'),{id:'unapproved',kind:'standard',locationId:'r',area:'BOH',data:{status:'draft'}}]};
 const welcome=employeeWelcome(w,'2026-09-17T00:00:00Z');assert.equal(welcome.nextShift.id,'real');assert.equal(welcome.guides.length,0);assert.equal(welcome.goals.length,0);assert.equal(welcome.managers.length,0);
 assert.equal(employeeWelcome({...w,records:[]}).nextShift,null);
});
