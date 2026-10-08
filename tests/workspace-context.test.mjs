import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceLoader, restaurantPreference, WorkspaceRequestError } from '../.sites-runtime/shared/workspace-context.mjs';

const b={id:'owner-berts',locationId:'berts',locationName:"Bert's",name:'Test owner',position:'Owner'};
const r={...b,id:'owner-rudds',locationId:'rudds',locationName:"Rudd's"};
const value=m=>({location:{id:m.locationId},me:{id:m.id},records:[]});
function storage(){const map=new Map();return {map,getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)}}
function setup(overrides={}){
  const store=storage(),preference=restaurantPreference('/api',()=>store);
  const options={memberships:async()=>({memberships:[b,r]}),workspace:async id=>value([b,r].find(m=>m.locationId===id)),preference,...overrides};
  return {store,preference,options,loader:createWorkspaceLoader(options)};
}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}

test('selected restaurant survives a loader reload; same-restaurant refresh keeps context',async()=>{
  const {loader,options,store}=setup();
  assert.equal((await loader.load()).workspace.location.id,'berts');
  assert.equal((await loader.load('rudds')).changed,true);
  assert.equal((await loader.load()).changed,false);
  const reloaded=await createWorkspaceLoader(options).load();
  assert.equal(reloaded.workspace.location.id,'rudds');assert.equal(reloaded.changed,true);
  assert.deepEqual(JSON.parse([...store.map.values()][0]),{memberId:r.id,locationId:r.locationId});
});

test('revoked or different-person preference falls back visibly to an authorized membership',async()=>{
  const {loader,options,preference}=setup();await loader.load('rudds');
  const other={...r,id:'other-person-rudds'};
  const next=await createWorkspaceLoader({...options,memberships:async()=>({memberships:[b,other]})}).load();
  assert.equal(next.workspace.location.id,'berts');assert.match(next.notice,/no longer available/);
  assert.equal(preference.read().memberId,b.id);
  options.memberships=async()=>({memberships:[b]});
  const revoked=await loader.load();assert.equal(revoked.workspace.location.id,'berts');assert.equal(revoked.changed,true);
});

test('explicit unavailable restaurant is rejected, never silently substituted',async()=>{
  let reads=0;const {loader,preference}=setup({workspace:async()=>{reads++;return value(b)}});
  await loader.load('berts');
  await assert.rejects(loader.load('unassigned'),e=>e.status===403);
  assert.equal(reads,1);assert.equal(preference.read(),null);assert.equal(loader.isLoading(),false);
});

test('a remembered restaurant is only saved after a matching authorized response',async()=>{
  const {loader,options,preference}=setup();await loader.load('berts');
  options.workspace=async()=>{throw new WorkspaceRequestError('Unavailable',503)};
  await assert.rejects(loader.load('rudds'),e=>e.status===503);
  assert.equal(preference.read().locationId,'berts');
  options.workspace=async()=>value({...r,id:'different-user'});
  await assert.rejects(loader.load('rudds'),e=>e.status===401);assert.equal(preference.read(),null);
});

test('stale scoped success and stale forbidden error cannot replace a newer restaurant',async()=>{
  for(const outcome of ['success','forbidden']){
    const slow=deferred(),started=deferred();
    const {loader,preference}=setup({workspace:async id=>{if(id==='berts'){started.resolve();return slow.promise}return value(r)}});
    const first=loader.load('berts');await started.promise;
    const second=await loader.load('rudds');assert.equal(second.workspace.location.id,'rudds');
    if(outcome==='success')slow.resolve(value(b));else slow.reject(new WorkspaceRequestError('Old denied read',403));
    assert.equal(await first,undefined);assert.equal(preference.read().locationId,'rudds');assert.equal(loader.isLoading(),false);
  }
});

test('stale membership results do not start another scoped fetch or clear a current load',async()=>{
  const oldList=deferred(),newRead=deferred(),started=deferred();let calls=0,reads=0;
  const {loader}=setup({memberships:async()=>++calls===1?oldList.promise:{memberships:[b,r]},workspace:async()=>{reads++;started.resolve();return newRead.promise}});
  const old=loader.load('berts'),latest=loader.load('rudds');await started.promise;
  oldList.resolve({memberships:[b,r]});assert.equal(await old,undefined);assert.equal(reads,1);assert.equal(loader.isLoading(),true);
  newRead.resolve(value(r));assert.equal((await latest).workspace.location.id,'rudds');assert.equal(loader.isLoading(),false);
});

test('sign-out and unmount invalidate outstanding reads; sign-out clears only this preference',async()=>{
  for(const method of ['clear','invalidate']){
    const slow=deferred(),started=deferred();const {loader,store,preference}=setup({workspace:async()=>{started.resolve();return slow.promise}});
    preference.write({memberId:b.id,locationId:b.locationId});store.setItem('unrelated','keep');
    const pending=loader.load('rudds');await started.promise;loader[method]();slow.resolve(value(r));
    assert.equal(await pending,undefined);assert.equal(loader.isLoading(),false);assert.equal(store.getItem('unrelated'),'keep');
    assert.equal(preference.read()?.locationId??null,method==='clear'?null:'berts');
  }
});

test('disabled or malformed browser storage does not block authorized workspace loading',async()=>{
  for(const raw of ['{bad','null','[]','{"memberId":4,"locationId":"rudds"}']){
    const {loader,store}=setup();store.setItem('jmax.restaurant.v1:/api',raw);assert.equal((await loader.load()).workspace.location.id,'berts');
  }
  const preference=restaurantPreference('/api',()=>{throw new Error('Storage disabled')});
  const {loader}=setup({preference});assert.equal((await loader.load('rudds')).workspace.location.id,'rudds');loader.clear();
});

test('review and operating workspaces and independent tabs have separate preferences',async()=>{
  const one=storage(),two=storage();const live=restaurantPreference('/api',()=>one),review=restaurantPreference('/api/review/manager',()=>one),otherTab=restaurantPreference('/api',()=>two);
  live.write({memberId:r.id,locationId:r.locationId});assert.equal(review.read(),null);assert.equal(otherTab.read(),null);
  review.write({memberId:'review-manager',locationId:'owner-review'});live.clear();assert.equal(review.read().locationId,'owner-review');
});

test('a changed identity at the same restaurant resets the view; empty access clears preference',async()=>{
  const {loader,options,preference}=setup();await loader.load('rudds');
  const next={...r,id:'new-rudds-member'};options.memberships=async()=>({memberships:[next]});options.workspace=async()=>value(next);
  assert.equal((await loader.load()).changed,true);
  options.memberships=async()=>({memberships:[]});await assert.rejects(loader.load(),e=>e.status===403);assert.equal(preference.read(),null);
});
