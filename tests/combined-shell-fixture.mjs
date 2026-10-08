// Isolated combined-shell preview only. Never imported by application code.
import {seedMockWeek} from './mock-week-fixture.mjs';
import {closingSelection} from '../.sites-runtime/shared/publication.mjs';
import {planningStamp} from '../.sites-runtime/shared/schedule-review.mjs';

export async function seedCombinedSchedule(db, dispatchFetch, origin='http://127.0.0.1:6601') {
  const call=async(actor,action,input={},record)=>{
    const response=await dispatchFetch(origin+'/api/workspace'+(action?'':'?locationId=review'),{
      method:action?'POST':'GET',
      headers:{'oai-authenticated-user-id':actor+'-fixture','oai-authenticated-user-email':actor+'@example.test',Origin:origin,'Content-Type':'application/json'},
      ...(action?{body:JSON.stringify({requestId:crypto.randomUUID(),locationId:'review',action,input,...(record?{recordId:record.id??record.recordId,expectedRevision:record.revision}:{})})}:{})
    });
    return {status:response.status,data:await response.json()};
  };
  const expect=r=>{if(r.status!==200)throw Error('Fictional schedule setup failed: '+JSON.stringify(r.data));return r.data};
  const fixture=await seedMockWeek(db,call,{staffing:true});
  const before=expect(await call('publisher'));
  expect(await call('publisher','shift.publish-batch',{
    weekStart:fixture.start,
    drafts:fixture.drafts.map(r=>({id:r.id??r.recordId,revision:r.revision,closing:closingSelection(before,r.id??r.recordId)})),
    planningReview:planningStamp(before,fixture.start,fixture.drafts.map(r=>r.id??r.recordId)),
    coverageAcknowledged:true,
    coverageNote:'Fictional demo only: retain the sample Monday coverage gap so reviewers can see how the schedule highlights missing coverage. This is not a real restaurant staffing approval.',
    confirmed:true,note:'Published only inside the disposable combined-shell demonstration. No staff notification leaves this preview.'
  }));
  const published=expect(await call('publisher')).records.filter(r=>r.kind==='shift'&&r.data.published);
  if(published.length!==28)throw Error('Expected all 28 fictional weekly shifts to be published.');

  // Match the existing five preview identities. These are fixture membership
  // records, not application authentication overrides or real account edits.
  await db.batch([
    db.prepare("UPDATE locations SET name=? WHERE id='review'").bind(`DEMO ONLY · Weekly schedule · ${fixture.start}`),
    db.prepare("UPDATE memberships SET name='DEMO Owner',position='Owner',capabilities=? WHERE id='admin' AND location_id='review'").bind(JSON.stringify(['location.manage','schedule.manage','schedule.publish','schedule.change'])),
    db.prepare("UPDATE memberships SET email='foh@example.test',auth_user_id='foh-fixture',name='DEMO FOH manager' WHERE id='manager' AND location_id='review'"),
    db.prepare("UPDATE memberships SET name='DEMO BOH manager' WHERE id='boh' AND location_id='review'"),
    db.prepare("UPDATE memberships SET name='DEMO Avery · Server' WHERE id='worker' AND location_id='review'"),
    db.prepare("UPDATE memberships SET position=CASE WHEN area='BOH' THEN 'Cook' ELSE 'Server' END,name=CASE WHEN area='BOH' THEN 'DEMO frontline cook' ELSE 'DEMO frontline server' END WHERE email='worker@example.test' AND location_id<>'review'"),
    db.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?,?)').bind('combined-second-owner','otherowner@example.test','otherowner-fixture','review','DEMO second owner','Executive','Owner',JSON.stringify(['location.manage','schedule.manage','schedule.publish','schedule.change']),'[]'),
  ]);
  return {start:fixture.start,end:fixture.days[6],publishedShifts:published.length,locationId:'review',locationName:`DEMO ONLY · Weekly schedule · ${fixture.start}`};
}
