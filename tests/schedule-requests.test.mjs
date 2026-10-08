import test from 'node:test';
import assert from 'node:assert/strict';
import { requestStage, requestStatus } from '../.sites-runtime/shared/schedule-requests.mjs';

const zone='America/New_York';
test('unanswered requests remain pending even after their requested time passes',()=>{
  for(const status of ['pending','accepted-by-replacement'])assert.equal(requestStage({kind:'request',data:{status,end:'2026-09-09T21:00:00Z'}},'2026-09-10T22:00:00Z',zone),'pending');
  assert.equal(requestStage({kind:'availability',data:{status:'pending',endDate:'2026-09-01'}},'2026-09-10T22:00:00Z',zone),'pending');
  assert.equal(requestStatus({kind:'request',data:{type:'swap',status:'pending'}}),'Awaiting coworker');
  assert.equal(requestStatus({kind:'request',data:{type:'swap',status:'accepted-by-replacement'}}),'Awaiting approval');
});
test('approved availability remains current through the restaurant local last date',()=>{
  const rule={kind:'availability',data:{status:'approved',endDate:'2026-09-10'}};
  assert.equal(requestStage(rule,'2026-09-11T03:59:00Z',zone),'approved');
  assert.equal(requestStage(rule,'2026-09-11T04:00:00Z',zone),'history');
});
test('expired time off and declined or replaced rules belong in history',()=>{
  const request={kind:'request',data:{status:'approved',end:'2026-09-11T02:00:00Z'}};
  assert.equal(requestStage(request,'2026-09-11T01:59:00Z',zone),'approved');
  assert.equal(requestStage(request,'2026-09-11T02:00:00Z',zone),'history');
  for(const status of ['declined','superseded'])assert.equal(requestStage({kind:'availability',data:{status,endDate:'2026-12-31'}},'2026-09-10T22:00:00Z',zone),'history');
});
