// Fictional upstream responses for local browser verification only.
// Never deploy this harness or interpret its data as a live Toast read.
const restaurant='11111111-1111-4111-8111-111111111111',employee='22222222-2222-4222-8222-222222222222';
export const toastSchedulePreviewBindings={TOAST_LOCATION_ID:'review',TOAST_RESTAURANT_GUID:restaurant,TOAST_CLIENT_ID:'fictional-client',TOAST_CLIENT_SECRET:'fictional-secret'};
export async function seedToastSchedulePreview(db,weekStart){
 await db.prepare("INSERT INTO access_reviews(id,location_id,restaurant_guid,employee_id,source_at,source,data,status,member_id,revision,updated_at) VALUES('toast-schedule-preview','review',?,?,'2026-10-07','{}','{}','enabled','worker',1,'2026-10-07')").bind(restaurant,employee).run();
 return async request=>{
  const url=new URL(request.url);
  if(url.origin!=='https://ws-api.toasttab.com')return new Response('External services disabled in fictional review.',{status:503});
  if(url.pathname==='/authentication/v1/authentication/login'&&request.method==='POST')return Response.json({status:'SUCCESS',token:{tokenType:'Bearer',accessToken:'fictional-token',expiresIn:3600}});
  if(url.pathname!=='/labor/v1/shifts'||request.method!=='GET'||request.headers.get('Toast-Restaurant-External-ID')!==restaurant)return new Response('Fictional request not supported.',{status:503});
  const shift=(id,person,deleted=false)=>({guid:id,employeeReference:{guid:person},jobReference:{guid:'44444444-4444-4444-8444-444444444444'},inDate:weekStart+'T16:00:00Z',outDate:weekStart+'T21:00:00Z',modifiedDate:'2026-10-07T12:00:00Z',deleted});
  return Response.json([shift('33333333-3333-4333-8333-333333333333',employee),shift('55555555-5555-4555-8555-555555555555','66666666-6666-4666-8666-666666666666'),shift('77777777-7777-4777-8777-777777777777',employee,true)]);
 };
}
