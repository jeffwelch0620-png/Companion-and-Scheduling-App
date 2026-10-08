import {fixture as baseFixture} from './maintenance-meter-fixture.mjs';
import {handleServiceCostReport} from '../.sites-runtime/shared/maintenance-cost-report-service.mjs';
export const now='2026-09-30T05:00:00Z',range={from:'2026-09-01',through:'2026-09-30'};
export const facts={title:'DEMO freezer service',equipment:'DEMO freezer F-1',task:'Fictional complete task',sourceRef:'Fictional source',initialDue:'2026-10-01',intervalDays:30,warningDays:5,managerId:'manager',managerName:'DEMO manager'};
const asset={id:'asset-one',revision:1,facts:{title:'DEMO freezer',assetTag:'DEMO-F-1',placement:'Fictional kitchen',manufacturer:'',model:'',serial:'',sourceRef:'Fictional equipment label',details:''},checkedBy:'owner',checkedAt:now};
export const cost=(amountCents,ref='DEMO shared invoice')=>({id:crypto.randomUUID(),kind:'recorded',by:'owner',at:now,note:'Checked fictional allocation',amountCents,currency:'USD',documentDate:'2026-09-28',sourceRef:ref,allocation:'Only this service share; test amount includes tax'});
export const service=(id,date,c,extra={})=>({id,date,performedBy:'DEMO technician',evidence:'DEMO completion '+id,note:'DEMO work',by:'owner',at:now,plan:{...facts,asset},contact:null,voided:null,...(c?{costHistory:[c]}:{}),...extra});
export const plan=(services,overrides={})=>({...facts,status:'active',checkedBy:'owner',checkedAt:now,retirementNote:'',services,history:[],versions:[],...overrides});
export function sources(){
 const s=[service('paid','2026-09-28',cost(12539)),service('free','2026-09-29',cost(0,'DEMO warranty')),service('withdrawn','2026-09-29',cost(700),{costHistory:[cost(700),{id:'withdraw',kind:'withdrawn',by:'owner',at:now,note:'Wrong source withdrawn'}]}),service('void','2026-09-27',cost(9900),{voided:{by:'owner',at:now,reason:'DEMO duplicate service'}}),service('split','2026-09-28',cost(10000),{plan:{...facts,title:'DEMO second plan',asset:{...asset,revision:2,facts:{...asset.facts,title:'DEMO renamed freezer'}}}}),service('missing','2026-09-29',null),service('filed','2026-09-15',cost(2000,'DEMO earlier invoice'),{plan:{...facts,title:'DEMO retained service',asset:undefined}})];
 return s.map((x,i)=>({planId:i<4?'plan-a':i<6?'plan-b':'plan-filed',planRevision:1,planStatus:i===6?'retired':'active',archivedAt:i===6?now:null,serviceId:x.id,serviceDate:x.date,planTitle:x.plan.title,equipment:x.plan.equipment,assetId:x.plan.asset?.id??null,assetTag:x.plan.asset?.facts.assetTag??null,assetTitle:x.plan.asset?.facts.title??null,serviceEvidence:x.evidence,voidReason:x.voided?.reason??null,cost:x.costHistory?.at(-1)??null}));
}
export async function seedServiceCosts(db,locationId='a',ownerId='owner',managerId='manager'){
 const rows=sources();
 for(const id of ['plan-a','plan-b','plan-filed']){
  const matches=rows.filter(r=>r.planId===id),services=matches.map(r=>service(r.serviceId,r.serviceDate,r.cost,{plan:{...facts,title:r.planTitle,managerId,asset:r.assetId?asset:undefined},...(r.voidReason?{voided:{by:ownerId,at:now,reason:r.voidReason}}:{})}));
  const data=plan(services,{title:matches[0].planTitle,managerId,status:matches[0].planStatus});
  await db.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at,archived_at) VALUES(?,?,?,?,?,1,?,?,?)').bind(locationId+'-'+id,locationId,'maintenance',ownerId,'BOH',JSON.stringify(data),now,matches[0].archivedAt).run();
 }
}
export async function fixture(t){
 const f=await baseFixture(t);await seedServiceCosts(f.db);
 return {...f,report:async(actor='owner',query={},binding=f.db)=>{const url='/api/operations/service-costs?'+new URLSearchParams({locationId:'a',...range,...query});if(f.compiled)return f.request(actor,url);const response=await handleServiceCostReport(new Request('http://localhost'+url,{headers:{'oai-authenticated-user-id':actor+'-identity','oai-authenticated-user-email':actor+'@example.test'}}),binding);return {status:response.status,headers:response.headers,data:await response.json()};}};
}
export const modelWorkspace=()=>({location:{id:'a',name:'DEMO restaurant',timezone:'America/New_York',revision:1},me:{id:'owner',locationId:'a',name:'DEMO owner',position:'Owner',area:'Executive',capabilities:['location.manage']},members:[],records:[]});
