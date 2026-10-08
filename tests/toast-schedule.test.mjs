import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchToastSchedule,normalizeToastSchedule} from '../.sites-runtime/shared/toast-schedule.mjs';
import {readConnectedToastSchedule} from '../.sites-runtime/shared/toast-connection.mjs';
const guid=n=>'aaaaaaaa-aaaa-4aaa-8aaa-'+String(n).padStart(12,'0');
const config={restaurantGuid:guid(1),host:'https://ws-api.toasttab.com',accessToken:'test-only'},week='2026-09-14',zone='America/New_York';
const shift=(n=2,patch={})=>({guid:guid(n),externalId:'sample-'+n,employeeReference:{guid:guid(3)},jobReference:{guid:guid(4)},inDate:'2026-09-20T20:00:00.000-0400',outDate:'2026-09-21T01:00:00.000-0400',deleted:false,modifiedDate:'2026-09-13T00:00:00.000Z',wages:'discard this',...patch});
test('Toast schedule reader uses restaurant-scoped GET and retains Sunday overnight shifts without importing next-week shifts',async()=>{
 let seen;
 const r=await fetchToastSchedule(config,week,zone,async(url,options)=>{seen={url:new URL(url),options};return Response.json([shift(),shift(5,{inDate:'2026-09-21T10:00:00-0400',outDate:'2026-09-21T17:00:00-0400'}),shift(6,{deleted:true})])});
 assert.equal(seen.options.method,'GET');assert.equal(seen.options.redirect,'manual');assert.equal(seen.options.headers['Toast-Restaurant-External-ID'],guid(1));assert.equal(seen.url.pathname,'/labor/v1/shifts');
 assert.equal(seen.url.searchParams.get('startDate'),'2026-09-14T04:00:00.000Z');assert.equal(seen.url.searchParams.get('endDate'),'2026-09-22T04:00:00.000Z');
 assert.equal(r.shifts.length,2);assert.equal(r.shifts[0].end,'2026-09-21T05:00:00.000Z');assert.equal(r.shifts[1].deleted,true);assert.equal(r.source,'toast-labor-scheduled-shifts');assert.doesNotMatch(JSON.stringify(r),/wages|discard|test-only/);
});
test('Toast schedule snapshots reject duplicates, ambiguous times and partial identities rather than accepting partial schedules',()=>{
 for(const value of [[shift(),shift()],[shift(2,{jobReference:{}})],[shift(2,{deleted:undefined})],[shift(2,{inDate:'2026-09-20T20:00:00'})],[shift(2,{outDate:'2026-09-20T15:00:00-0400'})]])assert.throws(()=>normalizeToastSchedule(value,guid(1),week,zone));
 assert.throws(()=>normalizeToastSchedule([],guid(1),'2026-02-30',zone));assert.equal(normalizeToastSchedule([],guid(1),week,zone).shifts.length,0);
});
test('Toast read errors and unapproved hosts cannot be mistaken for empty successful schedules',async()=>{
 let calls=0;await assert.rejects(fetchToastSchedule({...config,host:'https://untrusted.example'},week,zone,async()=>{calls++;return Response.json([])}));assert.equal(calls,0);
 for(const status of [301,302,307,308,401,403,429,500])await assert.rejects(fetchToastSchedule(config,week,zone,async()=>new Response('private upstream error',{status})),e=>e.status===(status===429?429:503)&&!e.message.includes('private'));
});
test('connected schedule read authenticates server-side and never exposes credentials or invokes shift mutations',async()=>{
 const requests=[];const r=await readConnectedToastSchedule({...config,locationId:'review',clientId:'fixture-client',clientSecret:'fixture-secret'},week,zone,async(url,options)=>{requests.push({url,options});return url.includes('/authentication/')?Response.json({status:'SUCCESS',token:{tokenType:'Bearer',accessToken:'fixture-token',expiresIn:120}}):Response.json([shift()])});
 assert.equal(requests.length,2);assert.equal(requests[0].options.method,'POST');assert.equal(requests[1].options.method,'GET');assert.equal(requests[1].options.headers.Authorization,'Bearer fixture-token');assert.doesNotMatch(JSON.stringify(r),/fixture-secret|fixture-token|fixture-client/);
});
