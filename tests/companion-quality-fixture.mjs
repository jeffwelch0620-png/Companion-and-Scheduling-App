export const at='2026-09-14T21:00:00Z';
export function qualityWorkspace(){
 const member=(id,position,capabilities=[])=>({id,locationId:'quality',name:'Fictional '+id,area:'BOH',position,capabilities,qualifications:[position]});
 const employee=member('employee','Fry'),manager=member('manager','Manager',['tasks.manage','schedule.manage','close.confirm']),senior=member('senior','Senior',['close.verify']);
 const w={location:{id:'quality',name:'Fictional quality rehearsal',timezone:'America/New_York',revision:1},me:manager,members:[employee,manager,senior],records:[]};
 const add=(id,kind,ownerId,data,locationId='quality')=>{const r={id,kind,ownerId,data,locationId,area:'BOH',revision:1,updatedAt:at};w.records.push(r);return r};
 const guide=(position,zone)=>({title:`Fictional ${zone} practice`,position,zone,criteria:[`${zone} sample kit present`],source:'Software evaluation fixture, not a restaurant SOP',version:1,status:'approved',validationNote:'Fictional only',verification:'senior-then-manager',history:[],guide:{purpose:`Learn the fictional ${zone} kit`,preparation:['Read the practice card'],steps:[`Place the ${zone} card beside the sample kit`,`Ask Fictional senior to check the ${zone} practice result`],troubleshooting:[`If the ${zone} card is missing, stop and ask Fictional manager`],escalation:'Ask Fictional manager'}});
 const fry=add('fry-guide','standard','manager',guide('Fry','Fry'));
 const expo=add('expo-guide','standard','manager',guide('Expo','Expo'));
 for(let i=0;i<24;i++){
   add('busy-shift-'+i,'shift','employee',{personId:'employee',position:'Expo',start:'2026-09-14T20:00:00Z',end:'2026-09-15T03:00:00Z',published:true,cancelled:false});
   add('busy-close-'+i,'close','employee',{shiftId:'busy-shift-'+i,standardId:expo.id,standardRevision:expo.revision,standard:expo.data,verifierId:'senior',managerId:'manager',due:'2026-09-15T03:00:00Z',phase:'open',history:[]});
 }
 return {w,add,fry,expo,employee,manager,senior,guide};
}
