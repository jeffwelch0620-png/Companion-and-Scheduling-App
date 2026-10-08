// Fictional historical responses for browser validation. No operating imports.
export async function seedCheckinHistoryFixture(db){
 for(let i=1;i<=6;i++){
  const id='history-demo-'+i,start=`2026-01-${10+i}T16:00:00Z`,end=`2026-01-${10+i}T22:00:00Z`,owner='demo-worker-berts';
  const shift={personId:owner,start,end,position:'Fictional historical shift',published:true,cancelled:false};
  const data={title:'Shift check-in',employeeName:'Fictional employee',shiftId:'shift-'+id,shiftRevision:1,shift:{start,end,position:shift.position},experience:i<=4?'rough':'good',note:'Fictional history response '+i+' for software review only.',submittedAt:end,versions:[],history:[]};
  await db.batch([['shift-'+id,'shift',shift],[id,'shiftcheckin',data]].map(([rid,kind,content])=>db.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,1,?,?)').bind(rid,'berts',kind,owner,'FOH',JSON.stringify(content),end)));
 }
}
